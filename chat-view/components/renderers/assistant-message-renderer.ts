import { setIcon } from 'obsidian';
import type { EventBus } from '../../core/event-bus';
import { safeSetHtml } from '../../utils/dom-utils';

export type Mode = 'edit' | 'discuss' | 'web';

export type EditPositionData = {
    text: string;
    start: number;
    end: number;
    isWholeNote: boolean;
    appliedContent?: string;
    appliedStart?: number;
    appliedEnd?: number;
    anchorBefore?: string;
    anchorAfter?: string;
};

export interface AssistantMessageRendererDeps {
    ensureContainer: () => HTMLElement | null;
    isCurrentTab: (targetMode: Mode) => boolean;
    scrollToBottomIfNear: () => void;
    removeStreamingMessages: (mode: Mode) => void;
    streamingCursor: string;
    renderMarkdown: (markdown: string) => string;
    generateMessageId: () => string;
    eventBus?: Pick<EventBus, 'emit'>;
    getEditPositionData?: (editNumber: number) => EditPositionData | undefined;
    editState?: {
        getCurrentEditNumber?: () => number | undefined;
        setCurrentEditNumber?: (value: number) => void;
        setEditPosition?: (editNumber: number, position: EditPositionData) => void;
        readActiveFile?: () => Promise<string | null>;
    };
}

/**
 * AssistantMessageRenderer
 * - Streaming assistant messages
 * - Finalization into markdown
 * - Edit-mode result messages (Apply/Save/Add-to-context)
 */
export class AssistantMessageRenderer {
    constructor(private deps: AssistantMessageRendererDeps) {}

    attachResultButtons(
        messageEl: HTMLElement,
        editNumber: number,
        resultContent: string,
        positionData?: EditPositionData
    ): void {
        const eventBus = this.deps.eventBus;
        if (!eventBus) return;
        if (messageEl.querySelector('.message-actions')) return;

        const resultForActions = resultContent ?? '';
        if (resultForActions.length === 0) return;

        this.restoreEditState(editNumber, positionData);

        const btnContainer = messageEl.createEl('div', { cls: 'message-actions' }) as HTMLElement;
        const buttonsGroup = btnContainer.createEl('div', { cls: 'action-buttons-group' }) as HTMLElement;

        const applyBtn = buttonsGroup.createEl('button', {
            cls: 'action-text-btn',
            attr: { 'aria-label': 'Apply to note' }
        });
        const applyIcon = applyBtn.createSpan({ cls: 'action-btn-icon' }) as HTMLElement;
        setIcon(applyIcon, 'check');
        applyBtn.createSpan({ text: 'Apply', cls: 'action-btn-label' });
        applyBtn.addEventListener('click', () => {
            eventBus.emit('edit:apply', { content: resultForActions, editNumber });
        });

        const applyHistoryBtn = buttonsGroup.createEl('button', {
            cls: 'action-icon-btn',
            attr: { 'aria-label': 'Apply to note + save history' }
        });
        setIcon(applyHistoryBtn, 'save');
        applyHistoryBtn.addEventListener('click', () => {
            eventBus.emit('edit:applyWithHistory', { content: resultForActions, editNumber });
        });

        const editGroup = btnContainer.createEl('div', { cls: 'action-buttons-group' }) as HTMLElement;
        const editContextBtn = editGroup.createEl('button', {
            cls: 'action-text-btn edit-context-btn',
            attr: { 'aria-label': 'Add to context' }
        });
        editContextBtn.createSpan({ text: `Edit ${editNumber}`, cls: 'action-btn-label' });
        const editIcon = editContextBtn.createSpan({ cls: 'action-btn-icon' }) as HTMLElement;
        setIcon(editIcon, 'arrow-down');
        editContextBtn.addEventListener('click', () => {
            eventBus.emit('edit:addToContext', { content: resultForActions, editNumber });
        });
    }

    reconnectResultButtons(
        messageEl: HTMLElement,
        editNumber: number,
        resultContent: string,
        positionData?: EditPositionData
    ): void {
        this.restoreEditState(editNumber, positionData);

        const eventBus = this.deps.eventBus;
        if (!eventBus) return;

        const resultForActions = resultContent ?? '';
        if (resultForActions.length === 0) return;

        const applyBtn = messageEl.querySelector('.action-text-btn[aria-label="Apply to note"]');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                eventBus.emit('edit:apply', { content: resultForActions, editNumber });
            });
        }

        const applySaveBtn = messageEl.querySelector(
            '.action-icon-btn[aria-label="Apply to note + save history"]'
        );
        if (applySaveBtn) {
            applySaveBtn.addEventListener('click', () => {
                eventBus.emit('edit:applyWithHistory', { content: resultForActions, editNumber });
            });
        }

        const editContextBtn = messageEl.querySelector('.edit-context-btn[aria-label="Add to context"]');
        if (editContextBtn) {
            editContextBtn.addEventListener('click', () => {
                eventBus.emit('edit:addToContext', { content: resultForActions, editNumber });
            });
        }
    }

    private restoreEditState(editNumber: number, positionData?: EditPositionData): void {
        const state = this.deps.editState;
        if (!state) return;

        const currentEditNumber = state.getCurrentEditNumber?.();
        if (currentEditNumber !== undefined && editNumber > currentEditNumber) {
            state.setCurrentEditNumber?.(editNumber);
        }

        if (!positionData) return;
        const existingPosition = this.deps.getEditPositionData?.(editNumber);
        const mergedPosition: EditPositionData = existingPosition
            ? {
                ...positionData,
                appliedContent: existingPosition.appliedContent,
                appliedStart: existingPosition.appliedStart,
                appliedEnd: existingPosition.appliedEnd
            }
            : { ...positionData };
        state.setEditPosition?.(editNumber, mergedPosition);

        if (!positionData.anchorBefore || !positionData.anchorAfter) return;
        if (!state.readActiveFile || !state.setEditPosition) return;

        void state.readActiveFile()
            .then((noteContent) => {
                if (!noteContent) return;

                const beforeIndex = noteContent.indexOf(positionData.anchorBefore!);
                if (beforeIndex === -1) return;

                const afterIndex = noteContent.indexOf(positionData.anchorAfter!, beforeIndex);
                if (afterIndex === -1) return;

                const actualStart = beforeIndex + positionData.anchorBefore!.length;
                const actualEnd = afterIndex;
                const actualText = noteContent.substring(actualStart, actualEnd);

                if (actualText !== positionData.text) return;

                state.setEditPosition!(editNumber, {
                    ...mergedPosition,
                    start: actualStart,
                    end: actualEnd
                });
            })
            .catch(() => {
                // best-effort only
            });
    }

    addStreamingMessage(isResult: boolean, mode: Mode, afterElement?: HTMLElement): HTMLElement | null {
        const container = this.deps.ensureContainer();
        if (!container) return null;

        this.deps.removeStreamingMessages(mode);

        const messageEl = document.createElement('div');
        messageEl.className = isResult
            ? 'chat-message assistant-message result-message streaming-message'
            : 'chat-message assistant-message streaming-message';
        messageEl.setAttribute('data-mode', mode);

        const msgId = this.deps.generateMessageId();
        messageEl.setAttribute('data-msg-id', msgId);
        messageEl._msgId = msgId;

        const contentEl = messageEl.createEl('div', { cls: 'message-content' }) as HTMLElement;
        contentEl.empty();
        contentEl.createEl('span', { cls: 'cursor-blink', text: this.deps.streamingCursor });

        if (afterElement && afterElement.parentNode) {
            afterElement.insertAdjacentElement('afterend', messageEl);
        } else {
            container.appendChild(messageEl);
        }

        if (!this.deps.isCurrentTab(mode)) {
            messageEl.classList.add('oa-hidden');
        }

        this.deps.scrollToBottomIfNear();
        return messageEl;
    }

    updateStreamingMessage(messageEl: HTMLElement | null, chunk: string): void {
        if (!messageEl) return;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const contentEl = messageEl.querySelector('.message-content') as HTMLElement | null;
        if (!contentEl) return;

        const content = chunk || '';

        if (!content) {
            contentEl.empty();
            contentEl.createEl('span', { cls: 'cursor-blink', text: this.deps.streamingCursor });
            return;
        }

        const codeBlockCount = (content.match(/```/g) || []).length;
        const hasIncompleteBlock = codeBlockCount % 2 !== 0;

        if (hasIncompleteBlock) {
            const lastTripleBacktick = content.lastIndexOf('```');
            const completedPart = content.substring(0, lastTripleBacktick);
            const incompletePart = content.substring(lastTripleBacktick);

            let html = '';
            if (completedPart) {
                html = this.deps.renderMarkdown(completedPart);
            }

            const escapedIncomplete = incompletePart
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');

            safeSetHtml(contentEl, html + escapedIncomplete);
            this.appendCursorInline(contentEl);
        } else {
            const renderedContent = this.deps.renderMarkdown(content);
            safeSetHtml(contentEl, renderedContent);
            this.appendCursorInline(contentEl);
        }

        this.deps.scrollToBottomIfNear();
    }

    /**
     * Appends cursor inside the deepest last block element (e.g. last <li>, last <td>)
     * so the cursor appears inline with the text being typed, not below the block.
     * Uses lastChild (not lastElementChild) to detect trailing text nodes —
     * e.g. when a new table row is still incomplete, text sits outside the <table>.
     */
    private appendCursorInline(contentEl: HTMLElement): void {
        let target = contentEl;

        while (true) {
            // Find last meaningful child (skip whitespace-only text nodes)
            let lastChild = target.lastChild;
            while (lastChild && lastChild.nodeType === Node.TEXT_NODE && !(lastChild.textContent || '').trim()) {
                lastChild = lastChild.previousSibling;
            }

            if (!lastChild) break;

            // Text node with content → cursor stays at this level
            if (lastChild.nodeType === Node.TEXT_NODE) break;

            // Block element → dive deeper
            if (lastChild.nodeType === Node.ELEMENT_NODE) {
                const tag = (lastChild as HTMLElement).tagName;
                if (['UL', 'OL', 'LI', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH',
                     'BLOCKQUOTE', 'DIV', 'P', 'DETAILS'].includes(tag)) {
                    target = lastChild as HTMLElement;
                    continue;
                }
            }

            break;
        }

        target.createEl('span', { cls: 'cursor-blink', text: this.deps.streamingCursor });
    }

    finalizeExplanationMessage(el: HTMLElement | null, content: string): void {
        if (!el) return;
        if (!content || !content.trim()) {
            el.remove();
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const contentEl = el.querySelector('.message-content') as HTMLElement | null;
        if (contentEl) safeSetHtml(contentEl, this.deps.renderMarkdown(content.trim()));

        const msgId = el._msgId || el.getAttribute('data-msg-id') || this.deps.generateMessageId();
        if (!el.getAttribute('data-msg-id')) el.setAttribute('data-msg-id', msgId);

        el.classList.remove('streaming-message');
        this.deps.scrollToBottomIfNear();

        this.emitMessageRendered(el, msgId);
    }

    finalizeStreamingMessage(el: HTMLElement | null, content: string): void {
        if (!el) return;
        if (!content || !content.trim()) {
            el.remove();
            return;
        }

        const mode = (el.getAttribute('data-mode') as Mode) || 'edit';
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const contentEl = el.querySelector('.message-content') as HTMLElement | null;
        if (contentEl) {
            const cursor = contentEl.querySelector('.cursor-blink');
            if (cursor) cursor.remove();
            safeSetHtml(contentEl, this.deps.renderMarkdown(content.trim()));
        }

        if (mode === 'edit' && !content.includes('<EDIT>')) {
            const warningContainer = el.createEl('div', { cls: 'model-warning' }) as HTMLElement;
            const iconEl = warningContainer.createEl('span', { cls: 'warning-icon' }) as HTMLElement;
            iconEl.textContent = '⚠';
            warningContainer.createEl('span', {
                text: 'The model failed to process your request. The selected model may be too weak for this mode, or try rephrasing your request.',
                cls: 'warning-text'
            });
        }

        const msgId = el._msgId || el.getAttribute('data-msg-id') || this.deps.generateMessageId();
        if (!el.getAttribute('data-msg-id')) el.setAttribute('data-msg-id', msgId);

        el.classList.remove('streaming-message');
        this.deps.scrollToBottomIfNear();

        this.emitMessageRendered(el, msgId);
    }

    finalizeDiscussMessage(el: HTMLElement | null, content: string): void {
        this.finalizeStreamingMessage(el, content);
    }

    finalizeResultMessage(
        el: HTMLElement | null,
        resultContent: string,
        mode: Mode,
        getPositionData?: () => {
            text: string;
            start: number;
            end: number;
            isWholeNote: boolean;
            anchorBefore?: string;
            anchorAfter?: string;
        } | undefined
    ): void {
        if (!el) return;

        const finalResult = resultContent ?? '';
        if (finalResult.length === 0) {
            el.remove();
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const contentEl = el.querySelector('.message-content') as HTMLElement | null;
        if (contentEl) {
            const cursor = contentEl.querySelector('.cursor-blink');
            if (cursor) cursor.remove();
            safeSetHtml(contentEl, this.deps.renderMarkdown(finalResult));
        }

        const msgId = el._msgId || el.getAttribute('data-msg-id') || this.deps.generateMessageId();
        if (!el.getAttribute('data-msg-id')) el.setAttribute('data-msg-id', msgId);

        const isEditMode = mode === 'edit';
        const editAttr = el.getAttribute('data-edit-number');
        const editNumber = isEditMode ? (editAttr ? parseInt(editAttr, 10) || 0 : 0) : 0;

        const positionData = getPositionData?.();

        el.classList.add('result-message');
        if (isEditMode) {
            this.attachResultButtons(el, editNumber, finalResult, positionData);
        }

        el.classList.remove('streaming-message');
        this.deps.scrollToBottomIfNear();

        this.emitMessageRendered(el, msgId);
    }

    private emitMessageRendered(el: HTMLElement, msgId: string): void {
        const mode = (el.getAttribute('data-mode') as Mode) || 'edit';

        let reasoningHtml: string | undefined;
        let reasoningCollapsed: boolean | undefined;

        let currentEl = el.previousElementSibling as HTMLElement | null;
        while (currentEl) {
            if (currentEl.classList.contains('reasoning-block')) {
                if (currentEl.getAttribute('data-mode') === mode) {
                    const reasoningData = currentEl._finalizedReasoningData;
                    if (reasoningData) {
                        reasoningHtml = reasoningData.html;
                        reasoningCollapsed = reasoningData.collapsed;
                    }
                }
                break;
            }
            if (currentEl.classList.contains('user-message')) break;
            // System messages can appear between reasoning and assistant output (esp. web mode).
            // Don't treat them as a barrier for attaching reasoning to the assistant message.
            if (currentEl.classList.contains('assistant-message') && !currentEl.classList.contains('system-message')) break;
            currentEl = currentEl.previousElementSibling as HTMLElement | null;
        }

        this.deps.eventBus?.emit('message:rendered', {
            messageId: msgId,
            mode,
            uiData: {
                html: el.innerHTML,
                classes: el.className,
                reasoningHtml,
                reasoningCollapsed
            }
        });
    }
}
