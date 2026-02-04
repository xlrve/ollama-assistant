import type { EditPosition } from '../state/types';
import type { TextRange } from './note-text-search';

type FoundRange = { index: number; length: number; foundInEdit: number };

export function resolveAppliedOccurrence(
    fullText: string,
    position: EditPosition,
    findBestOccurrence: (
        haystack: string,
        needle: string,
        preferredIndex: number,
        excludeSpoilers?: boolean,
        blockedRanges?: TextRange[]
    ) => number | null
): { index: number; length: number } | null {
    if (!position.appliedContent) return null;

    const preferredStart = position.appliedStart ?? position.start;
    const preferredEnd = position.appliedEnd ?? position.end;
    const appliedText = position.appliedContent;
    const atPreferred = fullText.substring(preferredStart, preferredEnd);

    if (atPreferred === appliedText) {
        return { index: preferredStart, length: appliedText.length };
    }

    const found = findBestOccurrence(fullText, appliedText, preferredStart);
    if (found === null) return null;
    return { index: found, length: appliedText.length };
}

export function collectOverlappingAppliedEdits(
    fullText: string,
    start: number,
    length: number,
    positions: Iterable<[number, EditPosition]>,
    findBestOccurrence: (
        haystack: string,
        needle: string,
        preferredIndex: number,
        excludeSpoilers?: boolean,
        blockedRanges?: TextRange[]
    ) => number | null
): number[] {
    const end = start + length;
    const overlapping: number[] = [];

    for (const [editNum, candidatePosition] of positions) {
        const occurrence = resolveAppliedOccurrence(fullText, candidatePosition, findBestOccurrence);
        if (!occurrence) continue;
        const occStart = occurrence.index;
        const occEnd = occurrence.index + occurrence.length;
        if (occStart < end && occEnd > start) {
            overlapping.push(editNum);
        }
    }

    return overlapping;
}

export function getProtectedRanges(
    fullText: string,
    chain: number[],
    resolvePosition: (editNumber: number) => EditPosition | undefined,
    findAllRanges: (haystack: string, needle: string) => TextRange[],
    mergeRanges: (ranges: TextRange[]) => TextRange[],
    extraSnippets: string[] = []
): TextRange[] {
    const ranges: TextRange[] = [];

    for (const chainEditNum of chain) {
        const position = resolvePosition(chainEditNum);
        if (!position?.appliedContent) continue;
        ranges.push(...findAllRanges(fullText, position.appliedContent));
    }

    for (const snippet of extraSnippets) {
        if (!snippet) continue;
        ranges.push(...findAllRanges(fullText, snippet));
    }

    return mergeRanges(ranges);
}

export function findGlobalAppliedFallback(
    fullText: string,
    editNumber: number,
    currentPosition: EditPosition,
    chain: number[],
    positions: Iterable<[number, EditPosition]>,
    getRootOriginalFromChain: (editNumber: number) => string,
    extractTrailingHistoryOriginal: (content: string) => string | null,
    findBestOccurrence: (
        haystack: string,
        needle: string,
        preferredIndex: number,
        excludeSpoilers?: boolean,
        blockedRanges?: TextRange[]
    ) => number | null
): FoundRange | null {
    const rootOriginal = getRootOriginalFromChain(editNumber);
    const currentText = currentPosition.text || '';
    const targetSnippets = [currentText, rootOriginal].filter((snippet) => snippet.length > 0);
    if (targetSnippets.length === 0) return null;

    const chainSet = new Set(chain);
    const preferredStart = currentPosition.start;

    let bestCandidate:
        | { index: number; length: number; foundInEdit: number; relevance: number; distance: number }
        | null = null;

    for (const [candidateEdit, candidatePosition] of positions) {
        if (chainSet.has(candidateEdit)) continue;
        if (!candidatePosition.appliedContent) continue;

        const occurrence = resolveAppliedOccurrence(fullText, candidatePosition, findBestOccurrence);
        if (!occurrence) continue;

        const appliedText = candidatePosition.appliedContent;
        let relevance = 0;

        for (const snippet of targetSnippets) {
            if (snippet && appliedText.includes(snippet)) {
                relevance += 2;
            }
        }

        const historyOriginal = extractTrailingHistoryOriginal(appliedText);
        if (historyOriginal && targetSnippets.includes(historyOriginal)) {
            relevance += 3;
        }

        if (relevance === 0) continue;

        const distance = Math.abs(occurrence.index - preferredStart);
        if (
            !bestCandidate ||
            relevance > bestCandidate.relevance ||
            (relevance === bestCandidate.relevance && distance < bestCandidate.distance)
        ) {
            bestCandidate = {
                ...occurrence,
                foundInEdit: candidateEdit,
                relevance,
                distance
            };
        }
    }

    if (!bestCandidate) return null;
    return {
        index: bestCandidate.index,
        length: bestCandidate.length,
        foundInEdit: bestCandidate.foundInEdit
    };
}

export function expandToContainingAppliedRange(
    fullText: string,
    found: FoundRange,
    editNumber: number,
    position: EditPosition | undefined,
    primaryEdits: Set<number>,
    positions: Iterable<[number, EditPosition]>,
    collectAnchorSnippets: (editNumber: number, position: EditPosition) => string[],
    arePositionsFromSameSource: (a: EditPosition, b: EditPosition) => boolean,
    findBestOccurrence: (
        haystack: string,
        needle: string,
        preferredIndex: number,
        excludeSpoilers?: boolean,
        blockedRanges?: TextRange[]
    ) => number | null
): FoundRange {
    const preferredStart = position?.start ?? found.index;
    const crossEditSnippets = position
        ? collectAnchorSnippets(editNumber, position).filter((s) => s.length >= 24).slice(0, 12)
        : [];

    let best:
        | { index: number; length: number; foundInEdit: number; distance: number }
        | null = null;

    const foundStart = found.index;
    const foundEnd = found.index + found.length;
    const foundText = fullText.substring(foundStart, foundEnd);

    for (const [candidateEdit, candidatePosition] of positions) {
        const inPrimarySet = primaryEdits.has(candidateEdit);
        if (!inPrimarySet) {
            if (found.foundInEdit !== editNumber) continue;
            if (!position) continue;
            if (found.length < 24 || !foundText) continue;
            if (!candidatePosition.appliedContent) continue;
            if (!candidatePosition.appliedContent.includes(foundText)) continue;
            if (Math.abs((candidatePosition.appliedStart ?? candidatePosition.start) - foundStart) > 2500) continue;
            if (!arePositionsFromSameSource(position, candidatePosition)) continue;

            const hasStrongLink = crossEditSnippets.some((snippet) =>
                candidatePosition.appliedContent!.includes(snippet)
            );
            const hasHistoryLink = /<summary>\s*Before editing\s*<\/summary>/i.test(candidatePosition.appliedContent);
            const sameAnchors =
                !!position.anchorBefore &&
                !!position.anchorAfter &&
                !!candidatePosition.anchorBefore &&
                !!candidatePosition.anchorAfter &&
                position.anchorBefore === candidatePosition.anchorBefore &&
                position.anchorAfter === candidatePosition.anchorAfter;
            const sameSourceText =
                !!position.text &&
                !!candidatePosition.text &&
                position.text === candidatePosition.text;
            if (!hasStrongLink && !hasHistoryLink && !sameAnchors && !sameSourceText) continue;
        }
        if (!candidatePosition.appliedContent) continue;
        const occurrence = resolveAppliedOccurrence(fullText, candidatePosition, findBestOccurrence);
        if (!occurrence) continue;

        const occStart = occurrence.index;
        const occEnd = occurrence.index + occurrence.length;
        const strictlyContains =
            occStart <= foundStart &&
            occEnd >= foundEnd &&
            (occStart !== foundStart || occurrence.length !== found.length);

        if (!strictlyContains) continue;

        const distance = Math.abs(occStart - preferredStart);
        if (
            !best ||
            occurrence.length < best.length ||
            (occurrence.length === best.length && distance < best.distance)
        ) {
            best = {
                ...occurrence,
                foundInEdit: candidateEdit,
                distance
            };
        }
    }

    if (!best) return found;
    return {
        index: best.index,
        length: best.length,
        foundInEdit: best.foundInEdit
    };
}
