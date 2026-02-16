/**
 * NoteService - handles Obsidian note operations
 * Event-Driven: listens to edit:apply, edit:applyWithHistory events
 * and applies changes to the active note. UI independent.
 */

import { Notice, type App, type Editor, type EventRef, type MarkdownView } from 'obsidian';
import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';
import type { EditPosition } from '../state/types';
import { Actions } from '../core/actions';
import {
    type TextRange,
    findAllRanges,
    findBestOccurrence,
    findSnippetOccurrenceInRange,
    mergeRanges,
    tryFindText
} from './note-text-search';
import {
    buildContentWithHistory,
    expandRangeToAdjacentHistoryBlocks,
    extractTrailingHistoryOriginal,
    splitTrailingHistoryBlocks
} from './note-history-blocks';
import {
    arePositionsEquivalentForSync as arePositionsEquivalentForSyncFn,
    arePositionsFromSameSource as arePositionsFromSameSourceFn,
    findRangeByAnchors as findRangeByAnchorsFn,
    getPreferredLength as getPreferredLengthFn,
    normalizeAnchorTarget as normalizeAnchorTargetFn,
    sanitizeExpandedRange as sanitizeExpandedRangeFn
} from './note-position-logic';
import {
    collectOverlappingAppliedEdits as collectOverlappingAppliedEditsFn,
    expandToContainingAppliedRange as expandToContainingAppliedRangeFn,
    findGlobalAppliedFallback as findGlobalAppliedFallbackFn,
    getProtectedRanges as getProtectedRangesFn
} from './note-chain-logic';
import {
    shiftUntouchedPositionsAfterReplaceInMap,
    updateChainPositionsInMap
} from './note-state-sync';

export class NoteService {
    private pendingEdit: { content: string; editNumber: number } | null = null;
    private pendingEditMenuEvent: EventRef | null = null;
    private registerEvent?: (ref: EventRef) => void;
    private getEditPositionMap: () => Map<number, EditPosition>;
    private applyInProgress: boolean = false;

    constructor(
        private app: App,
        private eventBus: EventBus,
        private store: Store,
        getEditPositionMap: () => Map<number, EditPosition>,
        registerEvent?: (ref: EventRef) => void
    ) {
        this.getEditPositionMap = getEditPositionMap;
        this.registerEvent = registerEvent;
        
        console.debug('[NoteService] Initializing, subscribing to events...');
        
        // Subscribe to events
        this.eventBus.on('edit:apply', this.handleApplyEdit.bind(this));
        this.eventBus.on('edit:applyWithHistory', this.handleApplyEditWithHistory.bind(this));
        
        console.debug('[NoteService] Subscribed to edit:apply and edit:applyWithHistory');
    }

    /**
     * Resolve edit position from editPositionMap
     */
    private resolvePosition(editNumber: number): EditPosition | undefined {
        return this.getEditPositionMap().get(editNumber);
    }

    private mergeRanges(ranges: TextRange[]): TextRange[] {
        return mergeRanges(ranges);
    }

    private findAllRanges(haystack: string, needle: string): TextRange[] {
        return findAllRanges(haystack, needle);
    }

    /**
     * Find the best occurrence of needle in haystack, preferring the one closest to preferredIndex.
     * Returns null if not found.
     * @param excludeSpoilers - if true, skip occurrences inside <details> blocks
     */
    private findBestOccurrence(
        haystack: string,
        needle: string,
        preferredIndex: number,
        excludeSpoilers: boolean = false,
        blockedRanges: TextRange[] = []
    ): number | null {
        return findBestOccurrence(haystack, needle, preferredIndex, excludeSpoilers, blockedRanges);
    }

    /**
     * Get edit chain for the given edit number
     * Returns array of edit numbers: [self, parent, grandparent, ...]
     */
    private getEditChain(editNumber: number): number[] {
        const chain = this.store.getState().edits.chains.get(editNumber) || [];
        return [editNumber, ...chain];
    }

    private getEditsToUpdate(editNumber: number, extraEditNumbers: number[] = []): Set<number> {
        return new Set<number>([...this.getEditChain(editNumber), ...extraEditNumbers]);
    }

    private getChainEditSet(editNumber: number): Set<number> {
        return new Set<number>(this.getEditChain(editNumber));
    }

    private keepRelatedEdits(editNumber: number, candidateEdits: number[]): number[] {
        const chain = this.getChainEditSet(editNumber);
        const current = this.resolvePosition(editNumber);
        const kept = new Set<number>();

        for (const editNum of candidateEdits) {
            if (chain.has(editNum)) {
                kept.add(editNum);
                continue;
            }
            if (!current) continue;
            const candidate = this.resolvePosition(editNum);
            if (!candidate) continue;
            if (this.arePositionsEquivalentForSync(current, candidate)) {
                kept.add(editNum);
            }
        }

        return Array.from(kept);
    }

    private isInlineSelectionPosition(position: EditPosition): boolean {
        if (position.isWholeNote) return false;
        const source = position.text || '';
        if (!source) return false;
        if (/[\r\n]/.test(source)) return false;
        return this.getPreferredLength(position) <= 1200;
    }

    private collectSameSourceSiblingEdits(editNumber: number, inlineMode: boolean = false): number[] {
        const current = this.resolvePosition(editNumber);
        if (!current) return [];

        const currentStart = current.appliedStart ?? current.start;
        const siblings: number[] = [];

        for (const [candidateEditNum, candidate] of this.getEditPositionMap()) {
            if (candidateEditNum === editNumber) continue;
            if (!this.arePositionsFromSameSource(current, candidate)) continue;

            const anchorsMatch =
                !!current.anchorBefore &&
                !!current.anchorAfter &&
                !!candidate.anchorBefore &&
                !!candidate.anchorAfter &&
                current.anchorBefore === candidate.anchorBefore &&
                current.anchorAfter === candidate.anchorAfter;

            if (anchorsMatch) {
                siblings.push(candidateEditNum);
                continue;
            }

            if (inlineMode) {
                const sameSelectedText = !!current.text && !!candidate.text && current.text === candidate.text;
                const candidateStart = candidate.appliedStart ?? candidate.start;
                if (sameSelectedText && Math.abs(candidateStart - currentStart) <= 2500) {
                    siblings.push(candidateEditNum);
                }
                continue;
            }

            const candidateStart = candidate.appliedStart ?? candidate.start;
            if (Math.abs(candidateStart - currentStart) <= 6000) {
                siblings.push(candidateEditNum);
            }
        }

        return siblings;
    }

    private arePositionsFromSameSource(a: EditPosition, b: EditPosition): boolean {
        return arePositionsFromSameSourceFn(a, b);
    }

    private arePositionsEquivalentForSync(a: EditPosition, b: EditPosition): boolean {
        return arePositionsEquivalentForSyncFn(a, b);
    }

    private getAllEditNumbers(): number[] {
        return Array.from(this.getEditPositionMap().keys());
    }

    /**
     * Try to find specific text in document
     * @param excludeSpoilers - if true, skip matches inside <details> blocks
     */
    private tryFindText(
        fullText: string,
        searchText: string,
        preferredStart: number,
        preferredEnd: number,
        excludeSpoilers: boolean = false,
        blockedRanges: TextRange[] = []
    ): { index: number; length: number } | null {
        return tryFindText(
            fullText,
            searchText,
            preferredStart,
            preferredEnd,
            excludeSpoilers,
            blockedRanges
        );
    }

    /**
     * Find text position by searching through edit chain
     * Tries each position in chain from newest to oldest
     * For each edit, first tries appliedContent (after apply), then original text (for undo)
     */
    private getRootOriginalFromChain(editNumber: number): string {
        const chain = this.getEditChain(editNumber);
        const rootEditNumber = chain[chain.length - 1];
        const rootPosition = this.resolvePosition(rootEditNumber);
        return rootPosition?.text || '';
    }

    private clearAppliedState(editNumber: number, position: EditPosition): void {
        if (!position.appliedContent && position.appliedStart === undefined && position.appliedEnd === undefined) {
            return;
        }

        const updatedPosition: EditPosition = {
            ...position,
            appliedContent: undefined,
            appliedStart: undefined,
            appliedEnd: undefined
        };

        this.getEditPositionMap().set(editNumber, updatedPosition);
        Actions.setEditPosition(this.store, editNumber, updatedPosition);
    }

    private pruneStaleAppliedContent(fullText: string, chain: number[]): void {
        for (const chainEditNum of chain) {
            const position = this.resolvePosition(chainEditNum);
            if (!position?.appliedContent) continue;

            const appliedExists = fullText.indexOf(position.appliedContent) !== -1;
            if (appliedExists) continue;

            const originalExists = position.text
                ? this.tryFindText(fullText, position.text, position.start, position.end, true) !== null
                : false;

            // Typical undo case: applied content is gone, but original is back in note.
            if (originalExists) {
                console.debug(`[NoteService]   Edit ${chainEditNum}: appliedContent is stale, clearing applied state`);
                this.clearAppliedState(chainEditNum, position);
            }
        }
    }

    private pruneAllStaleAppliedContent(fullText: string): void {
        this.pruneStaleAppliedContent(fullText, this.getAllEditNumbers());
    }

    private collectOverlappingAppliedEdits(
        fullText: string,
        start: number,
        length: number
    ): number[] {
        return collectOverlappingAppliedEditsFn(
            fullText,
            start,
            length,
            this.getEditPositionMap(),
            this.findBestOccurrence.bind(this)
        );
    }

    private findRangeByAnchors(
        fullText: string,
        position: EditPosition
    ): { index: number; length: number } | null {
        return findRangeByAnchorsFn(fullText, position);
    }

    private getPreferredLength(position: EditPosition): number {
        return getPreferredLengthFn(position);
    }

    private collectAnchorSnippets(editNumber: number, position: EditPosition): string[] {
        const snippets: string[] = [];
        const seen = new Set<string>();

        const add = (snippet?: string): void => {
            if (!snippet) return;
            const value = snippet.trim();
            if (!value) return;
            if (seen.has(value)) return;
            seen.add(value);
            snippets.push(value);
        };

        add(position.appliedContent);
        add(position.text);

        const chain = this.getEditChain(editNumber);
        for (const chainEditNum of chain) {
            const chainPosition = this.resolvePosition(chainEditNum);
            if (!chainPosition) continue;
            add(chainPosition.appliedContent);
            add(chainPosition.text);
        }

        add(this.getRootOriginalFromChain(editNumber));

        // Prefer longer snippets first to tighten anchor fallback.
        snippets.sort((a, b) => b.length - a.length);
        return snippets.slice(0, 20);
    }

    private normalizeAnchorTarget(
        fullText: string,
        position: EditPosition,
        target: { index: number; length: number },
        candidateSnippets: string[] = []
    ): { index: number; length: number } | null {
        return normalizeAnchorTargetFn(fullText, position, target, candidateSnippets);
    }

    private getProtectedRanges(
        fullText: string,
        chain: number[],
        extraSnippets: string[] = []
    ): TextRange[] {
        return getProtectedRangesFn(
            fullText,
            chain,
            this.resolvePosition.bind(this),
            this.findAllRanges.bind(this),
            this.mergeRanges.bind(this),
            extraSnippets
        );
    }

    private extractTrailingHistoryOriginal(content: string): string | null {
        return extractTrailingHistoryOriginal(content);
    }

    private splitTrailingHistoryBlocks(content: string): { base: string; originals: string[] } {
        return splitTrailingHistoryBlocks(content);
    }

    private expandRangeToAdjacentHistoryBlocks(
        fullText: string,
        range: { index: number; length: number }
    ): { index: number; length: number } {
        return expandRangeToAdjacentHistoryBlocks(fullText, range);
    }

    private buildContentWithHistory(contentToApply: string, originalContent: string): string {
        return buildContentWithHistory(contentToApply, originalContent);
    }

    private findInChain(
        fullText: string,
        editNumber: number,
        options?: { protectedSnippets?: string[] }
    ): { index: number; length: number; foundInEdit: number } | null {
        const chain = this.getEditChain(editNumber);
        console.debug(`[NoteService] findInChain: Edit ${editNumber}, chain = [${chain.join(', ')}]`);
        this.pruneAllStaleAppliedContent(fullText);

        const protectedRanges = this.getProtectedRanges(
            fullText,
            chain,
            options?.protectedSnippets || []
        );

        for (const chainEditNum of chain) {
            const position = this.resolvePosition(chainEditNum);
            if (!position) {
                console.debug(`[NoteService]   Edit ${chainEditNum}: no position`);
                continue;
            }

            // First try appliedContent (what was inserted after last apply)
            // Don't exclude spoilers here - appliedContent may contain the spoiler
            if (position.appliedContent) {
                console.debug(`[NoteService]   Edit ${chainEditNum}: trying appliedContent "${position.appliedContent.substring(0, 30)}..."`);
                const found = this.tryFindText(
                    fullText,
                    position.appliedContent,
                    position.appliedStart ?? position.start,
                    position.appliedEnd ?? position.end,
                    false // don't exclude spoilers
                );
                if (found) {
                    console.debug(`[NoteService]   Edit ${chainEditNum}: FOUND appliedContent at ${found.index}`);
                    return { ...found, foundInEdit: chainEditNum };
                }
            }

            // Then try original text (handles undo scenarios)
            // EXCLUDE matches inside spoilers to prevent nested spoiler accumulation
            if (position.text) {
                console.debug(`[NoteService]   Edit ${chainEditNum}: trying original text "${position.text.substring(0, 30)}..." (excluding spoilers)`);
                // Debug: show what's at the saved position
                const atPosition = fullText.substring(position.start, position.end);
                console.debug(`[NoteService]   Document at saved position [${position.start}-${position.end}]: "${atPosition.substring(0, 50)}..."`);
                // Debug: check if text exists anywhere (ignoring excludeSpoilers)
                const anywhereIndex = fullText.indexOf(position.text);
                console.debug(`[NoteService]   Text exists anywhere in doc: ${anywhereIndex !== -1 ? `YES at ${anywhereIndex}` : 'NO'}`);

                const found = this.tryFindText(
                    fullText,
                    position.text,
                    position.start,
                    position.end,
                    true,
                    protectedRanges
                );
                if (found) {
                    console.debug(`[NoteService]   Edit ${chainEditNum}: FOUND original at ${found.index}`);
                    return { ...found, foundInEdit: chainEditNum };
                }
            }

            console.debug(`[NoteService]   Edit ${chainEditNum}: not found`);
        }

        const fallback = this.findGlobalAppliedFallback(fullText, editNumber);
        if (fallback) {
            console.debug(
                `[NoteService] findInChain: fallback found via Edit ${fallback.foundInEdit} at ${fallback.index}`
            );
            return fallback;
        }

        console.debug(`[NoteService] findInChain: NOTHING FOUND for Edit ${editNumber}`);
        return null;
    }

    private findExactCurrentContentTarget(
        fullText: string,
        position: EditPosition,
        contentToApply: string,
        editNumber: number
    ): { index: number; length: number; foundInEdit: number } | null {
        if (!contentToApply) return null;
        const preferredStart = position.appliedStart ?? position.start;
        const preferredEnd = position.appliedEnd ?? position.end;
        const direct = this.tryFindText(
            fullText,
            contentToApply,
            preferredStart,
            preferredEnd,
            false
        );
        if (!direct) return null;

        return {
            ...direct,
            foundInEdit: editNumber
        };
    }

    private findGlobalAppliedFallback(
        fullText: string,
        editNumber: number
    ): { index: number; length: number; foundInEdit: number } | null {
        const currentPosition = this.resolvePosition(editNumber);
        if (!currentPosition) return null;
        return findGlobalAppliedFallbackFn(
            fullText,
            editNumber,
            currentPosition,
            this.getEditChain(editNumber),
            this.getEditPositionMap(),
            this.getRootOriginalFromChain.bind(this),
            this.extractTrailingHistoryOriginal.bind(this),
            this.findBestOccurrence.bind(this)
        );
    }

    private expandToContainingAppliedRange(
        fullText: string,
        found: { index: number; length: number; foundInEdit: number },
        editNumber: number
    ): { index: number; length: number; foundInEdit: number } {
        const position = this.resolvePosition(editNumber);
        const primaryEdits = this.getEditsToUpdate(editNumber, [found.foundInEdit]);
        return expandToContainingAppliedRangeFn(
            fullText,
            found,
            editNumber,
            position,
            primaryEdits,
            this.getEditPositionMap(),
            this.collectAnchorSnippets.bind(this),
            this.arePositionsFromSameSource.bind(this),
            this.findBestOccurrence.bind(this)
        );
    }

    private sanitizeExpandedRange(
        fullText: string,
        position: EditPosition,
        baseRange: { index: number; length: number },
        expandedRange: { index: number; length: number }
    ): { index: number; length: number } {
        return sanitizeExpandedRangeFn(fullText, position, baseRange, expandedRange);
    }

    private findTrustedContainingAppliedRange(
        fullText: string,
        target: { index: number; length: number },
        candidateEdits: number[]
    ): { index: number; length: number; fromEdit: number } | null {
        const targetStart = target.index;
        const targetEnd = target.index + target.length;
        let best: { index: number; length: number; fromEdit: number; distance: number } | null = null;

        for (const editNum of candidateEdits) {
            const position = this.resolvePosition(editNum);
            if (!position?.appliedContent) continue;

            const occ = this.tryFindText(
                fullText,
                position.appliedContent,
                position.appliedStart ?? position.start,
                position.appliedEnd ?? position.end,
                false
            );
            if (!occ) continue;

            const occStart = occ.index;
            const occEnd = occ.index + occ.length;
            const strictlyContains =
                occStart <= targetStart &&
                occEnd >= targetEnd &&
                (occStart !== targetStart || occ.length !== target.length);
            if (!strictlyContains) continue;

            const distance = Math.abs(occStart - targetStart);
            if (
                !best ||
                occ.length < best.length ||
                (occ.length === best.length && distance < best.distance)
            ) {
                best = {
                    index: occ.index,
                    length: occ.length,
                    fromEdit: editNum,
                    distance
                };
            }
        }

        if (!best) return null;
        return {
            index: best.index,
            length: best.length,
            fromEdit: best.fromEdit
        };
    }

    private clampTargetForInlineContext(
        fullText: string,
        editNumber: number,
        position: EditPosition,
        proposed: { index: number; length: number },
        fallback: { index: number; length: number }
    ): { index: number; length: number } {
        if (!this.isInlineSelectionPosition(position)) return proposed;

        const preferredLength = Math.max(1, this.getPreferredLength(position));
        const proposedText = fullText.substring(proposed.index, proposed.index + proposed.length);
        const hasHistory = /<summary>\s*Before editing\s*<\/summary>/i.test(proposedText);
        const hasParagraphBreak = /\r?\n\s*\r?\n/.test(proposedText);
        const maxAllowedLength = hasHistory
            ? Math.max(preferredLength * 8, 2200)
            : Math.max(preferredLength * 4, 800);
        const isSuspicious =
            proposed.length > maxAllowedLength ||
            (hasParagraphBreak && !hasHistory);

        if (!isSuspicious) return proposed;

        const rangeStart = proposed.index;
        const rangeEnd = proposed.index + proposed.length;
        const preferredStart = position.appliedStart ?? position.start;
        const snippets: string[] = [];
        const seen = new Set<string>();
        const add = (value?: string): void => {
            if (!value) return;
            const normalized = value.trim();
            if (!normalized) return;
            if (seen.has(normalized)) return;
            seen.add(normalized);
            snippets.push(normalized);
        };

        add(position.appliedContent);
        add(position.text);

        for (const chainEditNum of this.getEditChain(editNumber)) {
            const chainPos = this.resolvePosition(chainEditNum);
            if (!chainPos) continue;
            add(chainPos.appliedContent);
            add(chainPos.text);
        }

        snippets.sort((a, b) => b.length - a.length);
        for (const snippet of snippets.slice(0, 16)) {
            const occ = findSnippetOccurrenceInRange(
                fullText,
                snippet,
                rangeStart,
                rangeEnd,
                preferredStart
            );
            if (!occ) continue;
            const occText = fullText.substring(occ.index, occ.index + occ.length);
            const occHasHistory = /<summary>\s*Before editing\s*<\/summary>/i.test(occText);
            if (!occHasHistory && /\r?\n\s*\r?\n/.test(occText)) continue;
            return occ;
        }

        return fallback;
    }

    private stabilizeTargetAgainstChainApplied(
        fullText: string,
        editNumber: number,
        target: { index: number; length: number },
        extraEditNumbers: number[] = []
    ): { index: number; length: number } {
        const candidateEdits = Array.from(this.getEditsToUpdate(editNumber, extraEditNumbers));
        const trusted = this.findTrustedContainingAppliedRange(fullText, target, candidateEdits);
        if (!trusted) return target;

        console.debug('[NoteService] Stabilized target to trusted applied range', {
            editNumber,
            fromEdit: trusted.fromEdit,
            oldTarget: target,
            trustedTarget: { index: trusted.index, length: trusted.length }
        });

        return { index: trusted.index, length: trusted.length };
    }

    /**
     * Update appliedContent for all edits in the chain after successful apply.
     * Keeps original text/start/end intact for undo compatibility.
     */
    private updateChainPositions(
        editNumber: number,
        newContent: string,
        newStart: number,
        extraEditNumbers: number[] = []
    ): void {
        const editSet = this.getEditsToUpdate(editNumber, extraEditNumbers);

        console.debug(
            `[NoteService] Updating appliedContent for edits: [${Array.from(editSet).join(', ')}]`
        );

        updateChainPositionsInMap(
            editSet,
            newContent,
            newStart,
            (chainEditNum) => this.getEditPositionMap().get(chainEditNum),
            (chainEditNum, updatedPosition) => {
                this.getEditPositionMap().set(chainEditNum, updatedPosition);
                Actions.setEditPosition(this.store, chainEditNum, updatedPosition);
            }
        );
    }

    private shiftUntouchedPositionsAfterReplace(
        replaceFrom: number,
        replaceTo: number,
        insertedLength: number,
        touchedEdits: Set<number>
    ): void {
        shiftUntouchedPositionsAfterReplaceInMap(
            replaceFrom,
            replaceTo,
            insertedLength,
            touchedEdits,
            this.getEditPositionMap(),
            (editNum, updated) => {
                this.getEditPositionMap().set(editNum, updated);
                Actions.setEditPosition(this.store, editNum, updated);
            }
        );
    }

    /**
     * Replace text in editor without triggering auto-scroll.
     * Uses CodeMirror 6 transaction with scrollIntoView: false.
     */
    private replaceTextWithoutScroll(editor: Editor, from: number, to: number, text: string): void {
        // Access CodeMirror EditorView directly
        const cm = (editor as unknown as { cm?: { dispatch?: (spec: { changes: { from: number; to: number; insert: string }; scrollIntoView: boolean }) => void } }).cm;
        if (cm && cm.dispatch) {
            // CodeMirror 6 transaction without scroll
            cm.dispatch({
                changes: { from, to, insert: text },
                scrollIntoView: false
            });
        } else {
            // Fallback to standard API with scroll restoration
            const savedScroll = editor.getScrollInfo();
            const startPos = editor.offsetToPos(from);
            const endPos = editor.offsetToPos(to);
            editor.replaceRange(text, startPos, endPos);
            editor.scrollTo(savedScroll.left, savedScroll.top);
        }
    }

    private replaceAndSync(
        editor: Editor,
        editNumber: number,
        target: { index: number; length: number },
        newContent: string,
        relatedEdits: number[]
    ): void {
        const current = this.resolvePosition(editNumber);
        const inlineMode = !!current && this.isInlineSelectionPosition(current);
        const siblingEdits = this.collectSameSourceSiblingEdits(editNumber, inlineMode);
        const syncedExtras = this.keepRelatedEdits(editNumber, [...relatedEdits, ...siblingEdits]);

        this.replaceTextWithoutScroll(
            editor,
            target.index,
            target.index + target.length,
            newContent
        );
        this.updateChainPositions(editNumber, newContent, target.index, syncedExtras);
        this.shiftUntouchedPositionsAfterReplace(
            target.index,
            target.index + target.length,
            newContent.length,
            this.getEditsToUpdate(editNumber, syncedExtras)
        );
        this.eventBus.emit('history:save');
    }

    private setWholeNoteAndSync(editor: Editor, editNumber: number, content: string): void {
        editor.setValue(content);
        this.updateChainPositions(editNumber, content, 0);
        this.eventBus.emit('history:save');
    }

    /**
     * Handle apply edit with 3-step algorithm:
     * 1. Check if original text is still at saved position
     * 2. Try to find original text anywhere in document
     * 3. Ask user to select manually if not found
     */
    private handleApplyEdit(data: { content: string; editNumber: number }): void {
        if (this.applyInProgress) {
            new Notice('Apply is already in progress, please wait...');
            return;
        }
        this.applyInProgress = true;
        try {
        console.debug('[NoteService] ========== handleApplyEdit ==========');
        console.debug('[NoteService] Edit number:', data.editNumber);
        console.debug('[NoteService] Content to apply (first 100 chars):', data.content.substring(0, 100));

        const view = this.getActiveMarkdownView();
        if (!view || !view.editor) {
            new Notice('Please open a note first');
            return;
        }

        const position = this.resolvePosition(data.editNumber);
        console.debug('[NoteService] Position for edit', data.editNumber, ':', position ? {
            text: position.text?.substring(0, 50) + '...',
            start: position.start,
            end: position.end,
            isWholeNote: position.isWholeNote
        } : 'NOT FOUND');

        if (!position) {
            this.setPendingAndMenu(data.content, data.editNumber);
            new Notice('Position lost. Use the note context menu to insert the pending edit here.');
            return;
        }

        const contentToApply = data.content;

        const fullText = view.editor.getValue();
        console.debug('[NoteService] Document length:', fullText.length);

        // Whole note replacement
        if (position.isWholeNote) {
            // Safety: only allow whole-note overwrite if the current note still matches
            // the captured whole-note text. Otherwise treat as lost position and fall back.
            if (position.start === 0 && position.end === fullText.length && position.text === fullText) {
                this.setWholeNoteAndSync(view.editor, data.editNumber, contentToApply);
                new Notice('Applied to note!');
                return;
            }

            console.warn('[NoteService] Whole-note apply rejected due to mismatch; falling back to safe apply', {
                editNumber: data.editNumber,
                capturedLen: position.text?.length,
                currentLen: fullText.length
            });
        }

        // Prefer exact current content match first (prevents duplicate headers/spoilers
        // when user applies then applies+save the same edit).
        const directFound = this.findExactCurrentContentTarget(
            fullText,
            position,
            contentToApply,
            data.editNumber
        );

        // Search through edit chain (current edit + all parent edits)
        const found = directFound ?? this.findInChain(fullText, data.editNumber, {
            protectedSnippets: [contentToApply]
        });
        if (found !== null) {
            const expanded = this.expandToContainingAppliedRange(fullText, found, data.editNumber);
            const expandedWithHistory = this.expandRangeToAdjacentHistoryBlocks(fullText, expanded);
            const sanitizedTarget = this.sanitizeExpandedRange(fullText, position, expanded, expandedWithHistory);
            const stabilizedTarget = this.stabilizeTargetAgainstChainApplied(
                fullText,
                data.editNumber,
                sanitizedTarget,
                [expanded.foundInEdit]
            );
            const targetRange = this.clampTargetForInlineContext(
                fullText,
                data.editNumber,
                position,
                stabilizedTarget,
                found
            );
            const textBeingReplaced = fullText.substring(targetRange.index, targetRange.index + targetRange.length);
            if (textBeingReplaced === contentToApply) {
                new Notice(`Edit ${data.editNumber} is already applied`);
                return;
            }
            console.debug('[NoteService] REPLACING:', {
                from: targetRange.index,
                to: targetRange.index + targetRange.length,
                oldText: textBeingReplaced.substring(0, 50) + '...',
                newText: contentToApply.substring(0, 50) + '...'
            });

            const chainExtras = this.keepRelatedEdits(data.editNumber, [expanded.foundInEdit]);
            this.replaceAndSync(view.editor, data.editNumber, targetRange, contentToApply, chainExtras);

            if (expanded.foundInEdit !== data.editNumber) {
                new Notice(`Applied Edit ${data.editNumber} (found via Edit ${expanded.foundInEdit})!`);
            } else {
                new Notice(`Applied Edit ${data.editNumber}!`);
            }
            return;
        }

        const alreadyAppliedAt = this.findBestOccurrence(fullText, contentToApply, position.start);
        if (alreadyAppliedAt !== null) {
            new Notice(`Edit ${data.editNumber} is already present in note`);
            return;
        }

        const anchorTarget = this.findRangeByAnchors(fullText, position);
        if (anchorTarget) {
            const anchorSnippets = this.collectAnchorSnippets(data.editNumber, position);
            const normalized = this.normalizeAnchorTarget(fullText, position, anchorTarget, anchorSnippets);
            if (!normalized) {
                console.warn('[NoteService] Anchor target rejected as unsafe (apply)', {
                    editNumber: data.editNumber,
                    anchorLength: anchorTarget.length,
                    preferredLength: this.getPreferredLength(position)
                });
            } else {
                const syntheticFound = {
                    index: normalized.index,
                    length: normalized.length,
                    foundInEdit: data.editNumber
                };
                const expanded = this.expandToContainingAppliedRange(fullText, syntheticFound, data.editNumber);
                const expandedWithHistory = this.expandRangeToAdjacentHistoryBlocks(fullText, expanded);
                const sanitizedTarget = this.sanitizeExpandedRange(fullText, position, expanded, expandedWithHistory);
                const stabilizedTarget = this.stabilizeTargetAgainstChainApplied(
                    fullText,
                    data.editNumber,
                    sanitizedTarget,
                    [expanded.foundInEdit]
                );
                const target = this.clampTargetForInlineContext(
                    fullText,
                    data.editNumber,
                    position,
                    stabilizedTarget,
                    syntheticFound
                );
                const textBeingReplaced = fullText.substring(target.index, target.index + target.length);
                if (textBeingReplaced === contentToApply) {
                    new Notice(`Edit ${data.editNumber} is already applied`);
                    return;
                }

                const extraEdits = this.keepRelatedEdits(data.editNumber, [
                    ...this.collectOverlappingAppliedEdits(fullText, target.index, target.length),
                    expanded.foundInEdit
                ]);
                this.replaceAndSync(view.editor, data.editNumber, target, contentToApply, extraEdits);
                new Notice(`Applied Edit ${data.editNumber} (found by anchors)!`);
                return;
            }
        }

        // Fallback: Position lost - ask user to select manually
        console.error('[NoteService] FAILED to find position for Edit', data.editNumber);
        this.setPendingAndMenu(contentToApply, data.editNumber);
        new Notice('Position lost. Use the note context menu to insert the pending edit here.');
        } finally {
            this.applyInProgress = false;
        }
    }

    /**
     * Handle apply edit with history (adds spoiler with old version)
     */
    private handleApplyEditWithHistory(data: { content: string; editNumber: number }): void {
        if (this.applyInProgress) {
            new Notice('Apply is already in progress, please wait...');
            return;
        }
        this.applyInProgress = true;
        try {
        const view = this.getActiveMarkdownView();
        if (!view || !view.editor) {
            new Notice('Please open a note first');
            return;
        }

        const position = this.resolvePosition(data.editNumber);

        if (!position) {
            this.setPendingAndMenu(data.content, data.editNumber);
            new Notice('Position lost. Use the note context menu to insert the pending edit here.');
            return;
        }

        const contentToApply = data.content;
        const fullText = view.editor.getValue();
        const rootOriginal = this.getRootOriginalFromChain(data.editNumber) || position.text || '';
        const expectedWithHistory = this.buildContentWithHistory(contentToApply, rootOriginal);

        // Whole note replacement
        if (position.isWholeNote) {
            if (position.start === 0 && position.end === fullText.length && position.text === fullText) {
                const contentWithHistory = this.buildContentWithHistory(contentToApply, position.text);
                this.setWholeNoteAndSync(view.editor, data.editNumber, contentWithHistory);
                new Notice('Applied to note with history!');
                return;
            }

            console.warn('[NoteService] Whole-note applyWithHistory rejected due to mismatch; falling back to safe apply', {
                editNumber: data.editNumber,
                capturedLen: position.text?.length,
                currentLen: fullText.length
            });
        }

        // Prefer exact current content match first (prevents duplicate headers/spoilers
        // when user applies then applies+save the same edit).
        const directFound = this.findExactCurrentContentTarget(
            fullText,
            position,
            contentToApply,
            data.editNumber
        );

        // Search through edit chain (current edit + all parent edits)
        const found = directFound ?? this.findInChain(fullText, data.editNumber, {
            protectedSnippets: [expectedWithHistory]
        });
        if (found !== null) {
            const expanded = this.expandToContainingAppliedRange(fullText, found, data.editNumber);
            const expandedWithHistory = this.expandRangeToAdjacentHistoryBlocks(fullText, expanded);
            const sanitizedTarget = this.sanitizeExpandedRange(fullText, position, expanded, expandedWithHistory);
            const stabilizedTarget = this.stabilizeTargetAgainstChainApplied(
                fullText,
                data.editNumber,
                sanitizedTarget,
                [expanded.foundInEdit]
            );
            const targetRange = this.clampTargetForInlineContext(
                fullText,
                data.editNumber,
                position,
                stabilizedTarget,
                found
            );
            const textBeingReplaced = fullText.substring(targetRange.index, targetRange.index + targetRange.length);
            const stripped = this.splitTrailingHistoryBlocks(textBeingReplaced);
            const historyOriginal = stripped.originals.length > 0
                ? stripped.originals[stripped.originals.length - 1]
                : (rootOriginal || stripped.base);
            const contentWithHistory = this.buildContentWithHistory(contentToApply, historyOriginal);

            if (textBeingReplaced === contentWithHistory) {
                new Notice(`Edit ${data.editNumber} with history is already applied`);
                return;
            }

            const chainExtras = this.keepRelatedEdits(data.editNumber, [expanded.foundInEdit]);
            this.replaceAndSync(view.editor, data.editNumber, targetRange, contentWithHistory, chainExtras);

            if (expanded.foundInEdit !== data.editNumber) {
                new Notice(`Applied Edit ${data.editNumber} with history (found via Edit ${expanded.foundInEdit})!`);
            } else {
                new Notice(`Applied Edit ${data.editNumber} with history!`);
            }
            return;
        }

        const alreadyHistoryAt = this.findBestOccurrence(fullText, expectedWithHistory, position.start);
        if (alreadyHistoryAt !== null) {
            new Notice(`Edit ${data.editNumber} with history is already present in note`);
            return;
        }

        const anchorTarget = this.findRangeByAnchors(fullText, position);
        if (anchorTarget) {
            const anchorSnippets = this.collectAnchorSnippets(data.editNumber, position);
            const normalized = this.normalizeAnchorTarget(fullText, position, anchorTarget, anchorSnippets);
            if (!normalized) {
                console.warn('[NoteService] Anchor target rejected as unsafe (applyWithHistory)', {
                    editNumber: data.editNumber,
                    anchorLength: anchorTarget.length,
                    preferredLength: this.getPreferredLength(position)
                });
            } else {
                const syntheticFound = {
                    index: normalized.index,
                    length: normalized.length,
                    foundInEdit: data.editNumber
                };
                const expanded = this.expandToContainingAppliedRange(fullText, syntheticFound, data.editNumber);
                const expandedWithHistory = this.expandRangeToAdjacentHistoryBlocks(fullText, expanded);
                const sanitizedTarget = this.sanitizeExpandedRange(fullText, position, expanded, expandedWithHistory);
                const stabilizedTarget = this.stabilizeTargetAgainstChainApplied(
                    fullText,
                    data.editNumber,
                    sanitizedTarget,
                    [expanded.foundInEdit]
                );
                const target = this.clampTargetForInlineContext(
                    fullText,
                    data.editNumber,
                    position,
                    stabilizedTarget,
                    syntheticFound
                );
                const textBeingReplaced = fullText.substring(target.index, target.index + target.length);
                const stripped = this.splitTrailingHistoryBlocks(textBeingReplaced);
                const historyOriginal = stripped.originals.length > 0
                    ? stripped.originals[stripped.originals.length - 1]
                    : (rootOriginal || stripped.base);
                const contentWithHistory = this.buildContentWithHistory(contentToApply, historyOriginal);

                if (textBeingReplaced === contentWithHistory) {
                    new Notice(`Edit ${data.editNumber} with history is already applied`);
                    return;
                }

                const extraEdits = this.keepRelatedEdits(data.editNumber, [
                    ...this.collectOverlappingAppliedEdits(fullText, target.index, target.length),
                    expanded.foundInEdit
                ]);
                this.replaceAndSync(view.editor, data.editNumber, target, contentWithHistory, extraEdits);
                new Notice(`Applied Edit ${data.editNumber} with history (found by anchors)!`);
                return;
            }
        }

        // Fallback: Position lost
        // Get the ORIGINAL text from the root of the chain for spoiler
        const oldContent = rootOriginal;
        const pendingContent = this.buildContentWithHistory(contentToApply, oldContent);
        this.setPendingAndMenu(pendingContent, data.editNumber);
        new Notice('Position lost. Use the note context menu to insert the pending edit here.');
        console.warn('[NoteService] Could not find original text for edit', data.editNumber);
        } finally {
            this.applyInProgress = false;
        }
    }

    /**
     * Register context menu item for pending edit insertion
     */
    private registerPendingEditContextMenu() {
        // Unregister previous
        if (this.pendingEditMenuEvent) {
            this.app.workspace.offref(this.pendingEditMenuEvent);
            this.pendingEditMenuEvent = null;
        }

        const menuEvent = this.app.workspace.on('editor-menu', (menu, editor) => {
            if (!this.pendingEdit) return;

            menu.addItem((item) => {
                item
                    .setTitle('Insert pending edit here')
                    .setIcon('paste')
                    .onClick(() => {
                        this.insertPendingEditAtCursor(editor);
                    });
            });
        });

        this.pendingEditMenuEvent = menuEvent;
        if (this.registerEvent) {
            this.registerEvent(menuEvent);
        }
    }

    private insertPendingEditAtCursor(editor: Editor) {
        if (!this.pendingEdit) {
            new Notice('No pending edit');
            return;
        }

        const { content, editNumber } = this.pendingEdit;

        const selection = editor.getSelection();
        if (selection) {
            editor.replaceSelection(content);
            new Notice(`Edit ${editNumber} inserted at selection!`);
        } else {
            editor.replaceRange(content, editor.getCursor());
            new Notice(`Edit ${editNumber} inserted at cursor!`);
        }

        this.clearPendingEdit();
    }

    private setPendingAndMenu(content: string, editNumber: number) {
        this.pendingEdit = { content, editNumber };
        this.registerPendingEditContextMenu();
    }

    private clearPendingEdit() {
        this.pendingEdit = null;
        if (this.pendingEditMenuEvent) {
            this.app.workspace.offref(this.pendingEditMenuEvent);
            this.pendingEditMenuEvent = null;
        }
    }

    /**
     * Get active markdown view
     */
    private getActiveMarkdownView(): MarkdownView | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;

        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const view = leaf.view as MarkdownView;
            if (view && view.file === activeFile && view.editor) {
                return view;
            }
        }

        return null;
    }

    /**
     * Get selected text from active note
     */
    getSelectedText(): { text: string; start: number; end: number } | null {
        const view = this.getActiveMarkdownView();
        if (!view || !view.editor) return null;

        const selection = view.editor.getSelection();
        if (selection) {
            const from = view.editor.getCursor('from');
            const to = view.editor.getCursor('to');
            const start = view.editor.posToOffset(from);
            const end = view.editor.posToOffset(to);

            return { text: selection, start, end };
        }

        return null;
    }

    /**
     * Get entire note content
     */
    getEntireNote(): { text: string; start: number; end: number } | null {
        const view = this.getActiveMarkdownView();
        if (!view || !view.editor) return null;

        const content = view.editor.getValue();
        return { text: content, start: 0, end: content.length };
    }
}

