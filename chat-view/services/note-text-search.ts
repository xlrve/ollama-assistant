export type TextRange = { start: number; end: number };

export function isInRanges(start: number, length: number, ranges: TextRange[] = []): boolean {
    if (ranges.length === 0) return false;
    const end = start + length;
    return ranges.some((range) => start < range.end && end > range.start);
}

export function mergeRanges(ranges: TextRange[]): TextRange[] {
    if (ranges.length <= 1) return ranges;
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: TextRange[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const prev = merged[merged.length - 1];
        const current = sorted[i];
        if (current.start <= prev.end) {
            prev.end = Math.max(prev.end, current.end);
        } else {
            merged.push({ ...current });
        }
    }
    return merged;
}

export function findAllRanges(haystack: string, needle: string): TextRange[] {
    if (!needle) return [];
    const ranges: TextRange[] = [];
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
        ranges.push({ start: idx, end: idx + needle.length });
        idx = haystack.indexOf(needle, idx + 1);
    }
    return ranges;
}

export function isInsideSpoiler(fullText: string, position: number): boolean {
    const textBefore = fullText.substring(0, position);
    const openTags = (textBefore.match(/<details>/gi) || []).length;
    const closeTags = (textBefore.match(/<\/details>/gi) || []).length;
    return openTags > closeTags;
}

export function findBestOccurrence(
    haystack: string,
    needle: string,
    preferredIndex: number,
    excludeSpoilers: boolean = false,
    blockedRanges: TextRange[] = []
): number | null {
    if (!needle) return null;
    let occurrences: number[] = [];
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
        occurrences.push(idx);
        idx = haystack.indexOf(needle, idx + 1);
    }

    if (excludeSpoilers) {
        occurrences = occurrences.filter((pos) => !isInsideSpoiler(haystack, pos));
    }
    if (blockedRanges.length > 0) {
        occurrences = occurrences.filter((pos) => !isInRanges(pos, needle.length, blockedRanges));
    }

    if (occurrences.length === 0) return null;
    if (occurrences.length === 1) return occurrences[0];

    let best = occurrences[0];
    let bestDist = Math.abs(best - preferredIndex);
    for (const occurrence of occurrences) {
        const dist = Math.abs(occurrence - preferredIndex);
        if (dist < bestDist) {
            best = occurrence;
            bestDist = dist;
        }
    }
    return best;
}

export function tryFindText(
    fullText: string,
    searchText: string,
    preferredStart: number,
    preferredEnd: number,
    excludeSpoilers: boolean = false,
    blockedRanges: TextRange[] = []
): { index: number; length: number } | null {
    if (!searchText) return null;

    const currentTextAtPosition = fullText.substring(preferredStart, preferredEnd);
    if (currentTextAtPosition === searchText) {
        if (
            (!excludeSpoilers || !isInsideSpoiler(fullText, preferredStart)) &&
            !isInRanges(preferredStart, searchText.length, blockedRanges)
        ) {
            return { index: preferredStart, length: searchText.length };
        }
    }

    const found = findBestOccurrence(fullText, searchText, preferredStart, excludeSpoilers, blockedRanges);
    if (found !== null) {
        return { index: found, length: searchText.length };
    }

    return null;
}

export function findSnippetOccurrenceInRange(
    fullText: string,
    snippet: string,
    rangeStart: number,
    rangeEnd: number,
    preferredStart: number
): { index: number; length: number } | null {
    if (!snippet) return null;

    let best: { index: number; length: number; dist: number } | null = null;
    let idx = fullText.indexOf(snippet, rangeStart);
    while (idx !== -1) {
        if (idx >= rangeEnd) break;
        const end = idx + snippet.length;
        if (end <= rangeEnd) {
            const dist = Math.abs(idx - preferredStart);
            if (
                !best ||
                dist < best.dist ||
                (dist === best.dist && snippet.length > best.length)
            ) {
                best = { index: idx, length: snippet.length, dist };
            }
        }
        idx = fullText.indexOf(snippet, idx + 1);
    }

    if (!best) return null;
    return { index: best.index, length: best.length };
}
