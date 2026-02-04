import type { EditPosition } from '../state/types';
import { findAllRanges, findSnippetOccurrenceInRange } from './note-text-search';
import { isHistoryOnlyFragment } from './note-history-blocks';

type IndexRange = { index: number; length: number };

export function arePositionsFromSameSource(a: EditPosition, b: EditPosition): boolean {
    const aText = a.text || '';
    const bText = b.text || '';
    const textMatches = aText.length >= 24 && bText.length >= 24 && aText === bText;

    const anchorsAvailable =
        !!a.anchorBefore && !!a.anchorAfter && !!b.anchorBefore && !!b.anchorAfter;
    const anchorsMatch = anchorsAvailable &&
        a.anchorBefore === b.anchorBefore &&
        a.anchorAfter === b.anchorAfter;

    return textMatches || anchorsMatch;
}

export function arePositionsEquivalentForSync(a: EditPosition, b: EditPosition): boolean {
    const anchorsAvailable =
        !!a.anchorBefore && !!a.anchorAfter && !!b.anchorBefore && !!b.anchorAfter;
    if (anchorsAvailable && a.anchorBefore === b.anchorBefore && a.anchorAfter === b.anchorAfter) {
        return true;
    }

    const aText = a.text || '';
    const bText = b.text || '';
    if (aText.length >= 48 && bText.length >= 48 && aText === bText) {
        const aStart = a.appliedStart ?? a.start;
        const bStart = b.appliedStart ?? b.start;
        return Math.abs(aStart - bStart) <= 4000;
    }

    return false;
}

export function getPreferredLength(position: EditPosition): number {
    return position.appliedContent?.length
        || position.text?.length
        || Math.max(0, position.end - position.start);
}

export function findRangeByAnchors(
    fullText: string,
    position: EditPosition
): IndexRange | null {
    const anchorBefore = position.anchorBefore || '';
    const anchorAfter = position.anchorAfter || '';

    if (!anchorBefore && !anchorAfter) return null;

    const preferredStart = Math.max(0, Math.min(fullText.length, position.start));
    const preferredLength = getPreferredLength(position);
    const maxReasonableLength = preferredLength > 0
        ? Math.max(preferredLength * 40, 4000)
        : 20000;

    const beforeStarts = anchorBefore
        ? findAllRanges(fullText, anchorBefore).map((r) => r.end)
        : [0];
    const afterStarts = anchorAfter
        ? findAllRanges(fullText, anchorAfter).map((r) => r.start)
        : [fullText.length];

    if (beforeStarts.length === 0 || afterStarts.length === 0) {
        return null;
    }

    if (!anchorBefore && anchorAfter) {
        const bestEnd = afterStarts.reduce((best, current) => {
            const bestDist = Math.abs((best - preferredLength) - preferredStart);
            const currentDist = Math.abs((current - preferredLength) - preferredStart);
            return currentDist < bestDist ? current : best;
        }, afterStarts[0]);
        const start = Math.max(0, bestEnd - preferredLength);
        return { index: start, length: Math.max(0, bestEnd - start) };
    }

    if (anchorBefore && !anchorAfter) {
        const bestStart = beforeStarts.reduce((best, current) => {
            const bestDist = Math.abs(best - preferredStart);
            const currentDist = Math.abs(current - preferredStart);
            return currentDist < bestDist ? current : best;
        }, beforeStarts[0]);
        const end = Math.min(fullText.length, bestStart + preferredLength);
        return { index: bestStart, length: Math.max(0, end - bestStart) };
    }

    let best: { index: number; length: number; dist: number; lenDelta: number } | null = null;

    for (const start of beforeStarts) {
        for (const end of afterStarts) {
            if (end < start) continue;
            const length = end - start;
            if (length > maxReasonableLength) continue;

            const dist = Math.abs(start - preferredStart);
            const lenDelta = Math.abs(length - preferredLength);

            if (
                !best ||
                dist < best.dist ||
                (dist === best.dist && lenDelta < best.lenDelta)
            ) {
                best = { index: start, length, dist, lenDelta };
            }
        }
    }

    if (!best) return null;
    return { index: best.index, length: best.length };
}

export function normalizeAnchorTarget(
    fullText: string,
    position: EditPosition,
    target: IndexRange,
    candidateSnippets: string[] = []
): IndexRange | null {
    const preferredStart = Math.max(0, Math.min(fullText.length, position.start));
    const preferredLength = getPreferredLength(position);
    const targetStart = target.index;
    const targetEnd = target.index + target.length;

    const snippets = candidateSnippets.length > 0
        ? candidateSnippets
        : [position.appliedContent || '', position.text || ''].filter((s) => s.length > 0);

    let bestSnippetRange: IndexRange | null = null;
    for (const snippet of snippets) {
        const found = findSnippetOccurrenceInRange(
            fullText,
            snippet,
            targetStart,
            targetEnd,
            preferredStart
        );
        if (!found) continue;
        if (!bestSnippetRange || found.length > bestSnippetRange.length) {
            bestSnippetRange = found;
        }
    }
    if (bestSnippetRange) {
        return bestSnippetRange;
    }

    if (preferredLength > 0 && target.length > Math.max(120, preferredLength * 1.5)) {
        return null;
    }

    const targetText = fullText.substring(targetStart, targetEnd);
    if (/\r?\n\s*\r?\n/.test(targetText)) {
        return null;
    }

    const hardCap = preferredLength > 0
        ? Math.max(1200, preferredLength * 8)
        : 1200;
    const softCap = preferredLength > 0
        ? Math.max(300, preferredLength * 3)
        : 300;

    if (target.length > hardCap) {
        return null;
    }

    if (preferredLength > 0 && preferredLength < 400 && target.length > softCap) {
        return null;
    }

    return target;
}

export function sanitizeExpandedRange(
    fullText: string,
    position: EditPosition,
    baseRange: IndexRange,
    expandedRange: IndexRange
): IndexRange {
    if (expandedRange.length <= baseRange.length) {
        return expandedRange;
    }

    const expandedText = fullText.substring(expandedRange.index, expandedRange.index + expandedRange.length);
    const hasHistoryBlock = /<summary>\s*Before editing\s*<\/summary>/i.test(expandedText);
    if (hasHistoryBlock) {
        const beforeExtra = fullText.substring(expandedRange.index, baseRange.index);
        const afterExtra = fullText.substring(
            baseRange.index + baseRange.length,
            expandedRange.index + expandedRange.length
        );
        if (isHistoryOnlyFragment(beforeExtra) && isHistoryOnlyFragment(afterExtra)) {
            return expandedRange;
        }
        return baseRange;
    }

    const preferredLength = getPreferredLength(position);
    const baseLen = Math.max(1, baseRange.length);
    const extra = expandedRange.length - baseRange.length;
    const ratio = expandedRange.length / baseLen;

    if (extra <= 220 && ratio <= 1.8) {
        return expandedRange;
    }

    if (preferredLength > 0) {
        const maxAllowed = Math.max(700, preferredLength * 3);
        if (expandedRange.length > maxAllowed) {
            return baseRange;
        }
    }

    const beforeExtra = fullText.substring(expandedRange.index, baseRange.index);
    const afterExtra = fullText.substring(
        baseRange.index + baseRange.length,
        expandedRange.index + expandedRange.length
    );
    const beforeHasParagraphBreak = /\r?\n\s*\r?\n/.test(beforeExtra);
    const afterHasParagraphBreak = /\r?\n\s*\r?\n/.test(afterExtra);
    if (beforeHasParagraphBreak && afterHasParagraphBreak) {
        return baseRange;
    }

    return expandedRange;
}
