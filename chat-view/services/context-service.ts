import { MarkdownRenderer, MarkdownView, Notice, type App, type Component } from 'obsidian';
import type { TabState } from '../types';

interface ContextServiceDeps {
    app: App;
    getCurrentTabState: () => TabState;
    getTabState: (mode: 'edit' | 'discuss' | 'web') => TabState;
    getCurrentTab: () => 'edit' | 'discuss' | 'web';
    getComponent: () => Component; // For MarkdownRenderer
}

export type ContextServiceUIRefs = {
    topSectionEl: HTMLElement;
    contextValueEl: HTMLElement;
    contextInfoEl: HTMLElement;
    contextCloseButtonEl: HTMLElement;
    addContextButtonEl: HTMLElement;
    contextPinButtonEl: HTMLElement;
    userContextTooltipEl: HTMLElement;
};

/**
 * ContextService - full context management: setting, clearing, UI preview, pin, +Add menu, tooltips.
 */
export class ContextService {
    private ui: ContextServiceUIRefs | null = null;
    // Last focused markdown view. Needed because clicking the +Add menu moves
    // focus to the chat view, so getActiveViewOfType() returns null at that point.
    private lastActiveMarkdownView: MarkdownView | null = null;

    constructor(private deps: ContextServiceDeps) {
        this.lastActiveMarkdownView = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
        this.deps.getComponent().registerEvent(
            this.deps.app.workspace.on('active-leaf-change', (leaf) => {
                if (leaf?.view instanceof MarkdownView) {
                    this.lastActiveMarkdownView = leaf.view;
                }
            })
        );
    }

    /**
     * Returns the markdown view the user is working with: the currently active one,
     * or the last focused one when focus is on the chat view (e.g. +Add menu clicks).
     */
    private getTargetMarkdownView(): MarkdownView | null {
        const active = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
        if (active) return active;

        const last = this.lastActiveMarkdownView;
        if (last && last.leaf?.view === last && last.containerEl.isConnected) {
            return last;
        }
        return null;
    }

    setUIRefs(refs: ContextServiceUIRefs): void {
        this.ui = refs;
        // Ensure UI reflects current state once refs are ready.
        this.updateSelectedTextPreview();
    }

    setupContextTooltip(contextInfoEl: HTMLElement): void {
        const doc = contextInfoEl.ownerDocument;
        const bodyEl = doc.body;
        const contextTooltip = bodyEl.createDiv({
            cls: 'context-tooltip oa-hidden',
            attr: { id: 'context-tooltip' }
        });
        let isHovering = false;
        let renderId = 0;

        contextInfoEl.addEventListener('mouseenter', () => {
            isHovering = true;
            const currentRenderId = ++renderId;
            void (async () => {
                const tabState = this.deps.getCurrentTabState();
                if (tabState.selectedText) {
                    contextTooltip.empty();
                    await MarkdownRenderer.render(
                        this.deps.app,
                        tabState.selectedText,
                        contextTooltip,
                        '',
                        this.deps.getComponent()
                    );

                    if (!isHovering || currentRenderId !== renderId) {
                        contextTooltip.addClass('oa-hidden');
                        return;
                    }

                    contextTooltip.removeClass('oa-hidden');

                    const rect = contextInfoEl.getBoundingClientRect();
                    contextTooltip.setCssProps({ '--oa-right': (window.innerWidth - rect.left + 5) + 'px', '--oa-left': 'auto', '--oa-bottom': (window.innerHeight - rect.top + 5) + 'px', '--oa-top': 'auto' });
                }
            })();
        });

        contextInfoEl.addEventListener('mouseleave', () => {
            isHovering = false;
            renderId++;
            contextTooltip.addClass('oa-hidden');
        });

        contextInfoEl.addEventListener(
            'wheel',
            (e) => {
                if (!contextTooltip.hasClass('oa-hidden')) {
                    e.preventDefault();
                    contextTooltip.scrollTop += e.deltaY;
                }
            },
            { passive: false }
        );
    }

    setupAddContextMenu(
        addContextButton: HTMLElement,
        addContextMenu: HTMLElement,
        addSelectedTextBtn: HTMLElement,
        addEntireNoteBtn: HTMLElement
    ): void {
        let isMenuOpen = false;
        const doc = addContextButton.ownerDocument;

        addContextButton.addEventListener('click', (e) => {
            e.stopPropagation();
            isMenuOpen = !isMenuOpen;
            addContextMenu.toggleClass('oa-hidden', !isMenuOpen);

            if (isMenuOpen) {
                const buttonRect = addContextButton.getBoundingClientRect();
                addContextMenu.setCssProps({ '--oa-left': 'auto', '--oa-right': `${window.innerWidth - buttonRect.right}px`, '--oa-bottom': `${window.innerHeight - buttonRect.top + 10}px` });
            }
        });

        addSelectedTextBtn.addEventListener('click', () => {
            void this.addSelectedTextFromNote();
            addContextMenu.addClass('oa-hidden');
            isMenuOpen = false;
        });

        addEntireNoteBtn.addEventListener('click', () => {
            void this.addEntireNote();
            addContextMenu.addClass('oa-hidden');
            isMenuOpen = false;
        });

        doc.addEventListener('click', () => {
            if (isMenuOpen) {
                isMenuOpen = false;
                addContextMenu.addClass('oa-hidden');
            }
        });
    }

    togglePin(contextPin: HTMLElement): void {
        const tabState = this.deps.getCurrentTabState();
        tabState.isContextPinned = !tabState.isContextPinned;
        if (tabState.isContextPinned) {
            contextPin.classList.add('pinned');
            contextPin.setAttribute('title', 'Unpin context');
        } else {
            contextPin.classList.remove('pinned');
            contextPin.setAttribute('title', 'Pin context');
        }
    }

    updateContextPreview(): void {
        this.updateSelectedTextPreview();
    }

    /**
     * Sets selected text as context
     */
    setSelectedText(text: string, isEntireNote: boolean = false): void {
        // Validation: Web mode doesn't support context
        if (this.deps.getCurrentTab() === 'web') {
            new Notice('Context is not supported in web mode.');
            return;
        }

        const tabState = this.deps.getCurrentTabState();
        tabState.selectedText = text;
        tabState.isContextPinned = false; // Reset pin state when setting new context

        // Get the active file and find its view
        const activeFile = this.deps.app.workspace.getActiveFile();
        if (activeFile) {
            const leaves = this.deps.app.workspace.getLeavesOfType('markdown');
            for (const leaf of leaves) {
                const view = leaf.view as MarkdownView;
                if (view && view.file === activeFile && view.editor) {
                    if (isEntireNote) {
                        // For entire note, calculate from start to end
                        const lastLine = view.editor.lastLine();
                        const lastLineLength = view.editor.getLine(lastLine).length;
                        tabState.selectedTextStart = 0;
                        tabState.selectedTextEnd = view.editor.posToOffset({ line: lastLine, ch: lastLineLength });
                        tabState.contextLabel = 'Entire note';
                    } else {
                        // For manual selection, use cursor position
                        const from = view.editor.getCursor('from');
                        const to = view.editor.getCursor('to');
                        tabState.selectedTextStart = view.editor.posToOffset(from);
                        tabState.selectedTextEnd = view.editor.posToOffset(to);

                        // Defensive: sometimes the provided text comes from a command/context menu,
                        // but editor cursor/selection offsets no longer point at that exact text.
                        // If offsets don't match, try to locate the text in the note and use that range.
                        try {
                            const noteContent = view.editor.getValue();
                            const start = tabState.selectedTextStart;
                            const end = tabState.selectedTextEnd;
                            const currentSlice = noteContent.substring(start, end);

                            if (text && currentSlice !== text) {
                                const occurrences: number[] = [];
                                let idx = noteContent.indexOf(text);
                                while (idx !== -1) {
                                    occurrences.push(idx);
                                    idx = noteContent.indexOf(text, idx + 1);
                                }

                                if (occurrences.length === 1) {
                                    tabState.selectedTextStart = occurrences[0];
                                    tabState.selectedTextEnd = occurrences[0] + text.length;
                                } else if (occurrences.length > 1) {
                                    const cursorOffset = view.editor.posToOffset(view.editor.getCursor());
                                    let best = occurrences[0];
                                    let bestDist = Math.abs(best - cursorOffset);
                                    for (const o of occurrences) {
                                        const dist = Math.abs(o - cursorOffset);
                                        if (dist < bestDist) {
                                            best = o;
                                            bestDist = dist;
                                        }
                                    }
                                    tabState.selectedTextStart = best;
                                    tabState.selectedTextEnd = best + text.length;
                                }
                            }
                        } catch {
                            // best-effort only
                        }

                        // Check if manual selection covers entire note
                        const lastLine = view.editor.lastLine();
                        const lastLineLength = view.editor.getLine(lastLine).length;
                        const noteEnd = view.editor.posToOffset({ line: lastLine, ch: lastLineLength });

                        if (tabState.selectedTextStart === 0 && tabState.selectedTextEnd === noteEnd) {
                            // User manually selected entire note
                            tabState.contextLabel = 'Entire note';
                        } else {
                            // Partial selection - show line numbers
                            tabState.contextLabel = undefined;
                        }
                    }
                    break;
                }
            }
        }

        this.updateSelectedTextPreview();
    }

    /**
     * Set selected text when caller already knows the exact offsets in the note.
     * This is used by commands that capture selection BEFORE switching focus to the chat view.
     */
    setSelectedTextWithOffsets(text: string, start: number, end: number, isEntireNote: boolean = false): void {
        // Validation: Web mode doesn't support context
        if (this.deps.getCurrentTab() === 'web') {
            new Notice('Context is not supported in web mode.');
            return;
        }

        const tabState = this.deps.getCurrentTabState();
        tabState.selectedText = text;
        tabState.isContextPinned = false;
        tabState.selectedTextStart = start;
        tabState.selectedTextEnd = end;

        if (isEntireNote) {
            tabState.contextLabel = 'Entire note';
            this.updateSelectedTextPreview();
            return;
        }

        // If the provided offsets cover the whole note, label it.
        try {
            const activeFile = this.deps.app.workspace.getActiveFile();
            if (activeFile) {
                const leaves = this.deps.app.workspace.getLeavesOfType('markdown');
                for (const leaf of leaves) {
                    const view = leaf.view as MarkdownView;
                    if (view && view.file === activeFile && view.editor) {
                        const lastLine = view.editor.lastLine();
                        const lastLineLength = view.editor.getLine(lastLine).length;
                        const noteEnd = view.editor.posToOffset({ line: lastLine, ch: lastLineLength });
                        if (start === 0 && end === noteEnd) {
                            tabState.contextLabel = 'Entire note';
                        } else {
                            tabState.contextLabel = undefined;
                        }
                        break;
                    }
                }
            }
        } catch {
            tabState.contextLabel = undefined;
        }

        this.updateSelectedTextPreview();
    }

    /**
     * Clears selected text
     */
    clearSelectedText(): void {
        const tabState = this.deps.getCurrentTabState();
        tabState.selectedText = '';
        tabState.selectedTextStart = 0;
        tabState.selectedTextEnd = 0;
        tabState.isContextPinned = false; // Reset pin state when clearing context
        tabState.contextLabel = undefined;

        this.updateSelectedTextPreview();
    }

    /**
     * Updates context preview in UI
     */
    updateSelectedTextPreview(): void {
        const ui = this.ui;
        if (!ui) return;

        const contextValue = ui.contextValueEl;
        const contextInfo = ui.contextInfoEl;
        const contextClose = ui.contextCloseButtonEl;
        const addContextButton = ui.addContextButtonEl;
        const contextPin = ui.contextPinButtonEl;
        const topSection = ui.topSectionEl;

        // Special handling for Web tab - context not supported
        if (this.deps.getCurrentTab() === 'web') {
            contextValue.textContent = 'Not supported';
            contextInfo.removeClass('is-visible');
            contextClose.classList.remove('context-close-visible');
            contextPin.addClass('oa-hidden');
            addContextButton.addClass('oa-hidden');
            topSection?.classList.remove('has-preview');
            return;
        }

        // Get current tab's selected text
        const tabState = this.deps.getCurrentTabState();
        const hasCustomContext = tabState.selectedText && tabState.selectedText.trim().length > 0;

        if (!hasCustomContext) {
            // No custom context - show "No context" and hide close button, pin button and info icon
            contextValue.textContent = 'No context';
            contextInfo.removeClass('is-visible');
            contextClose.classList.remove('context-close-visible');
            contextPin.addClass('oa-hidden');
            // Show +Add button when no context
            addContextButton.removeClass('oa-hidden');
            topSection?.classList.remove('has-preview');
            return;
        }

        // Show selected context with close button and info icon visible
        // Use label if available, otherwise compute and persist line numbers.
        let displayText = '';

        if (tabState.contextLabel) {
            displayText = tabState.contextLabel;
        } else {
            let startLine: number | null = null;
            let endLine: number | null = null;

            try {
                const activeFile = this.deps.app.workspace.getActiveFile();
                if (activeFile) {
                    const leaves = this.deps.app.workspace.getLeavesOfType('markdown');
                    for (const leaf of leaves) {
                        const view = leaf.view as MarkdownView;
                        if (view && view.file === activeFile && view.editor) {
                            const editor = view.editor;
                            if (tabState.selectedTextStart !== undefined && tabState.selectedTextEnd !== undefined) {
                                const startPos = editor.offsetToPos(tabState.selectedTextStart);
                                const endPos = editor.offsetToPos(tabState.selectedTextEnd);
                                startLine = startPos.line + 1;
                                endLine = endPos.line + 1;
                            }
                            break;
                        }
                    }
                }
            } catch {
                // ignore
            }

            // If we couldn't compute lines, fall back to a generic label.
            if (startLine == null || endLine == null) {
                displayText = 'Context';
            } else {
                displayText = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
            }

            // Persist the computed label so history/queue can carry it.
            tabState.contextLabel = displayText;
        }

        contextValue.textContent = displayText;
        contextClose.classList.add('context-close-visible');
        contextInfo.addClass('is-visible');

        // Show pin button and restore its state
        contextPin.removeClass('oa-hidden');
        if (tabState.isContextPinned) {
            contextPin.classList.add('pinned');
            contextPin.setAttribute('title', 'Unpin context');
        } else {
            contextPin.classList.remove('pinned');
            contextPin.setAttribute('title', 'Pin context');
        }

        // Hide +Add button when context exists
        addContextButton.addClass('oa-hidden');

        // No preview text needed - info icon shows tooltip on hover
        topSection?.classList.remove('has-preview');
    }

    /**
     * Attaches tooltip handlers to context icon in user message
     */
    attachUserContextTooltip(iconEl: HTMLElement, contextContent: string): void {
        const userContextTooltip = this.ui?.userContextTooltipEl;
        if (!userContextTooltip) return;
        let isHovering = false;
        let renderId = 0;

        iconEl.addEventListener('mouseenter', () => {
            isHovering = true;
            const currentRenderId = ++renderId;
            void (async () => {
                if (contextContent && contextContent.trim().length > 0) {
                    // Render markdown
                    userContextTooltip.empty();
                    await MarkdownRenderer.render(
                        this.deps.app,
                        contextContent,
                        userContextTooltip,
                        '',
                        this.deps.getComponent()
                    );

                    if (!isHovering || currentRenderId !== renderId) {
                        userContextTooltip.addClass('oa-hidden');
                        return;
                    }

                    userContextTooltip.removeClass('oa-hidden');

                    const rect = iconEl.getBoundingClientRect();

                    // Get tooltip dimensions (need to display it first to measure)
                    const tooltipRect = userContextTooltip.getBoundingClientRect();
                    const tooltipHeight = tooltipRect.height;

                    // Calculate available space above and below the icon
                    const spaceAbove = rect.top;
                    const spaceBelow = window.innerHeight - rect.bottom;

                    // Smart positioning: show above if there's more space above, otherwise below
                    if (spaceAbove > spaceBelow && spaceAbove >= tooltipHeight) {
                        // Show above (default)
                        userContextTooltip.setCssProps({ '--oa-bottom': (window.innerHeight - rect.top + 5) + 'px', '--oa-top': 'auto' });
                    } else {
                        // Show below
                        userContextTooltip.setCssProps({ '--oa-top': (rect.bottom + 5) + 'px', '--oa-bottom': 'auto' });
                    }

                    // Horizontal positioning (always to the left of icon)
                    userContextTooltip.setCssProps({ '--oa-right': (window.innerWidth - rect.left + 5) + 'px', '--oa-left': 'auto' });
                }
            })();
        });

        iconEl.addEventListener('mouseleave', () => {
            isHovering = false;
            renderId++;
            userContextTooltip.addClass('oa-hidden');
        });

        // Allow scrolling tooltip with mouse wheel when hovering over icon
        iconEl.addEventListener('wheel', (e) => {
            if (!userContextTooltip.hasClass('oa-hidden')) {
                e.preventDefault();
                userContextTooltip.scrollTop += e.deltaY;
            }
        }, { passive: false });
    }

    private addSelectedTextFromNote(): void {
        const mode = this.deps.getCurrentTab();
        if (mode === 'web') {
            new Notice('Context is not supported in web mode');
            return;
        }

        const view = this.getTargetMarkdownView();
        if (!view || !view.editor) {
            new Notice('No text selected in the note');
            return;
        }

        const selection = view.editor.getSelection();
        if (selection && selection.trim()) {
            this.setSelectedText(selection, false);
            new Notice(`Context added to ${mode} tab`);
            return;
        }
        new Notice('No text selected in the note');
    }

    private addEntireNote(): void {
        const mode = this.deps.getCurrentTab();
        if (mode === 'web') {
            new Notice('Context is not supported in web mode');
            return;
        }

        const view = this.getTargetMarkdownView();
        if (!view || !view.editor) {
            new Notice('No note found');
            return;
        }

        const entireNote = view.editor.getValue();
        if (entireNote && entireNote.trim()) {
            this.setSelectedText(entireNote, true);
            return;
        }
        new Notice('No note found');
    }
}
