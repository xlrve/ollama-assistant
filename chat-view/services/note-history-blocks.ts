type IndexRange = { index: number; length: number };

export function extractTrailingHistoryOriginal(content: string): string | null {
    if (!content) return null;
    const historyMatch = content.match(
        /<details(?:\s[^>]*)?>\s*<summary>\s*Before editing\s*<\/summary>\s*([\s\S]*?)\s*<\/details>\s*$/i
    );
    if (!historyMatch) return null;
    return historyMatch[1].trim();
}

export function splitTrailingHistoryBlocks(content: string): { base: string; originals: string[] } {
    let base = content;
    const originals: string[] = [];

    while (true) {
        const match = base.match(
            /\s*<details(?:\s[^>]*)?>\s*<summary>\s*Before editing\s*<\/summary>\s*([\s\S]*?)\s*<\/details>\s*$/i
        );
        if (!match || match.index === undefined) break;
        originals.push(match[1].trim());
        base = base.substring(0, match.index);
    }

    return { base, originals };
}

export function findMatchingDetailsEnd(fullText: string, detailsStart: number): number | null {
    const tagRegex = /<\/?details\b[^>]*>/gi;
    tagRegex.lastIndex = detailsStart;

    let depth = 0;
    while (true) {
        const match = tagRegex.exec(fullText);
        if (!match) break;

        const tag = match[0].toLowerCase();
        const isClosing = tag.startsWith('</details');
        if (!isClosing) {
            depth += 1;
        } else {
            depth -= 1;
            if (depth === 0) {
                return tagRegex.lastIndex;
            }
            if (depth < 0) {
                return null;
            }
        }
    }

    return null;
}

export function findMatchingDetailsStart(fullText: string, detailsCloseStart: number): number | null {
    const tagRegex = /<\/?details\b[^>]*>/gi;
    const stack: number[] = [];

    while (true) {
        const match = tagRegex.exec(fullText);
        if (!match) break;
        if (match.index > detailsCloseStart) break;

        const tag = match[0].toLowerCase();
        const isClosing = tag.startsWith('</details');

        if (!isClosing) {
            stack.push(match.index);
            continue;
        }

        const openStart = stack.pop();
        if (match.index === detailsCloseStart) {
            return openStart ?? null;
        }
    }

    return null;
}

export function isBeforeEditingHistoryBlock(blockText: string): boolean {
    return /<summary>\s*Before editing\s*<\/summary>/i.test(blockText);
}

export function isHistoryOnlyFragment(fragment: string): boolean {
    if (!fragment) return true;
    const normalized = fragment.trim();
    if (!normalized) return true;
    return /^(?:<details(?:\s[^>]*)?>\s*<summary>\s*Before editing\s*<\/summary>[\s\S]*?<\/details>\s*)+$/i.test(normalized);
}

export function expandRangeToTrailingHistoryBlocks(
    fullText: string,
    range: IndexRange
): IndexRange {
    const start = range.index;
    let end = range.index + range.length;

    while (end < fullText.length) {
        let cursor = end;
        while (cursor < fullText.length && /[\s]/.test(fullText[cursor])) {
            cursor += 1;
        }

        if (!fullText.substring(cursor).toLowerCase().startsWith('<details')) {
            break;
        }

        const blockEnd = findMatchingDetailsEnd(fullText, cursor);
        if (blockEnd === null) break;

        const blockText = fullText.substring(cursor, blockEnd);
        if (!isBeforeEditingHistoryBlock(blockText)) {
            break;
        }

        end = blockEnd;
    }

    return { index: start, length: Math.max(0, end - start) };
}

export function expandRangeToLeadingHistoryBlocks(
    fullText: string,
    range: IndexRange
): IndexRange {
    let start = range.index;
    const end = range.index + range.length;

    while (start > 0) {
        let cursor = start;
        while (cursor > 0 && /[\s]/.test(fullText[cursor - 1])) {
            cursor -= 1;
        }
        const closeTag = '</details>';
        const closeStart = fullText.lastIndexOf(closeTag, cursor - 1);
        if (closeStart === -1) break;

        const closeEnd = closeStart + closeTag.length;
        const gap = fullText.substring(closeEnd, cursor);
        if (gap.trim().length > 0) break;

        const detailsStart = findMatchingDetailsStart(fullText, closeStart);
        if (detailsStart === null) break;

        const blockText = fullText.substring(detailsStart, closeEnd);
        if (!isBeforeEditingHistoryBlock(blockText)) break;

        start = detailsStart;
    }

    return { index: start, length: Math.max(0, end - start) };
}

export function expandRangeToAdjacentHistoryBlocks(
    fullText: string,
    range: IndexRange
): IndexRange {
    const withLeading = expandRangeToLeadingHistoryBlocks(fullText, range);
    return expandRangeToTrailingHistoryBlocks(fullText, withLeading);
}

export function buildContentWithHistory(contentToApply: string, originalContent: string): string {
    if (!originalContent) return contentToApply;

    let separator = '\n\n';
    if (/\r?\n\r?\n$/.test(contentToApply)) {
        separator = '';
    } else if (/\r?\n$/.test(contentToApply)) {
        separator = '\n';
    }

    const spoiler = `\n\n<details>\n<summary>Before editing</summary>\n\n${originalContent}\n\n</details>`;
    return contentToApply + separator + spoiler.replace(/^\n\n/, '');
}
