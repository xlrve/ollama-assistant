import type { EventBus } from '../core/event-bus';
import { MarkdownUtils } from '../markdown-utils';
import type { TabState } from '../types';
import type { EditPosition } from '../state/types';
import { SystemMessageRenderer } from './renderers/system-message-renderer';
import { ReasoningRenderer } from './renderers/reasoning-renderer';
import { UserMessageRenderer } from './renderers/user-message-renderer';
import { AssistantMessageRenderer } from './renderers/assistant-message-renderer';
import { TurnRenderer } from './renderers/turn-renderer';
import { addAssistantToTurn, addResultToTurn, addSystemMessageToTurn, addErrorToTurn, addStopMessageToTurn, updateReasoningInTurn } from '../utils/turn-builder';
import { extractTextFromReasoningHtml } from '../utils/reasoning-utils';

export type Mode = 'edit' | 'discuss' | 'web';

export type EditPositionData = EditPosition;

export type MessageRendererDeps = {
    getMessagesContainer: () => HTMLElement | null;
    getCurrentTab: () => Mode;
    scrollToBottom: () => void;
    generateMessageId: () => string;
    getCurrentEditNumber: () => number;
    setCurrentEditNumber: (value: number) => void;
    setEditPosition: (editNumber: number, position: EditPositionData) => void;
    getEditPositionMap: () => Map<number, EditPositionData>;
    readActiveFile?: () => Promise<string | null>;
    getTabState?: (mode: Mode) => TabState;
    syncTurnsToStore?: (mode: Mode) => void;
};

/**
 * MessageRenderer
 * Message rendering coordinator via EventBus.
 */
export class MessageRenderer {
    private readonly STREAMING_CURSOR = '\u258A';
    private reasoningRenderer: ReasoningRenderer;

    private systemMessageRenderer: SystemMessageRenderer;
    private userMessageRenderer: UserMessageRenderer;
    private assistantMessageRenderer: AssistantMessageRenderer;
    private turnRenderer: TurnRenderer;

    private attachTooltipFn: ((el: HTMLElement, text: string) => void) | undefined;
    private eventBus: EventBus | undefined;

    constructor(private deps: MessageRendererDeps, eventBus?: EventBus, attachTooltipFn?: (el: HTMLElement, text: string) => void) {
        this.eventBus = eventBus;
        this.attachTooltipFn = attachTooltipFn;

        this.systemMessageRenderer = new SystemMessageRenderer({
            ensureContainer: () => this.ensureContainer(),
            isCurrentTab: (targetMode) => this.isCurrentTab(targetMode),
            scrollToBottomIfNear: () => this.scrollToBottomIfNear(),
            generateMessageId: () => this.deps.generateMessageId()
        });

        this.reasoningRenderer = new ReasoningRenderer({
            ensureContainer: () => this.ensureContainer(),
            isCurrentTab: (targetMode) => this.isCurrentTab(targetMode),
            scrollToBottomIfNear: () => this.scrollToBottomIfNear(),
            streamingCursor: this.STREAMING_CURSOR
        });

        this.userMessageRenderer = new UserMessageRenderer({
            ensureContainer: () => this.ensureContainer(),
            isCurrentTab: (targetMode) => this.isCurrentTab(targetMode),
            removeWelcomeMessages: (mode) => this.removeWelcomeMessages(mode),
            scrollToBottomIfNear: () => this.scrollToBottomIfNear(),
            generateMessageId: () => this.deps.generateMessageId(),
            getTooltipHandler: () => this.attachTooltipFn
        });

        this.assistantMessageRenderer = new AssistantMessageRenderer({
            ensureContainer: () => this.ensureContainer(),
            isCurrentTab: (targetMode) => this.isCurrentTab(targetMode),
            scrollToBottomIfNear: () => this.scrollToBottomIfNear(),
            removeStreamingMessages: (mode) => this.removeStreamingMessages(mode),
            streamingCursor: this.STREAMING_CURSOR,
            renderMarkdown: (md) => MarkdownUtils.renderMarkdown(md),
            generateMessageId: () => this.deps.generateMessageId(),
            eventBus: this.eventBus,
            getEditPositionData: (editNumber) => this.deps.getEditPositionMap().get(editNumber),
            editState: {
                getCurrentEditNumber: () => this.deps.getCurrentEditNumber(),
                setCurrentEditNumber: (value) => this.deps.setCurrentEditNumber(value),
                setEditPosition: (editNumber, position) => this.deps.setEditPosition(editNumber, position),
                readActiveFile: this.deps.readActiveFile
            }
        });

        this.turnRenderer = new TurnRenderer({
            getContainer: (mode) => this.ensureContainer(),
            isCurrentTab: (targetMode) => this.isCurrentTab(targetMode),
            scrollToBottomIfNear: () => this.scrollToBottomIfNear(),
            userMessageRenderer: this.userMessageRenderer,
            systemMessageRenderer: this.systemMessageRenderer,
            assistantMessageRenderer: this.assistantMessageRenderer,
            renderMarkdown: (md) => MarkdownUtils.renderMarkdown(md),
            generateMessageId: () => this.deps.generateMessageId(),
            removeWelcomeMessages: (mode) => this.removeWelcomeMessages(mode),
            onReasoningToggle: (mode, turnId, collapsed) => {
                if (!this.deps.getTabState) return;
                const tabState = this.deps.getTabState(mode);
                const turn = tabState.turns.find((t) => t.id === turnId);
                if (!turn?.reasoning) return;
                turn.reasoning.collapsed = collapsed;
                this.deps.syncTurnsToStore?.(mode);
                this.eventBus?.emit('history:save');
            }
        });

        if (eventBus) {
            this.registerEventHandlers(eventBus);
        }
    }

    setTooltipHandler(fn: (el: HTMLElement, text: string) => void) {
        this.attachTooltipFn = fn;
    }

    private ensureContainer(): HTMLElement | null {
        return this.deps.getMessagesContainer();
    }

    private isCurrentTab(targetMode: Mode): boolean {
        return this.deps.getCurrentTab() === targetMode;
    }

    private removeStreamingMessages(mode: 'edit' | 'discuss' | 'web'): void {
        const container = this.ensureContainer();
        if (!container) return;
        container.querySelectorAll(`.streaming-message[data-mode="${mode}"]`).forEach(el => el.remove());
    }

    private scrollToBottomIfNear(): void {
        const container = this.ensureContainer();
        if (!container) return;
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom) {
            this.deps.scrollToBottom();
        }
    }

    private getTurnContainer(mode: Mode, turnId: string): HTMLElement | null {
        const container = this.ensureContainer();
        if (!container) return null;
        return container.querySelector(
            `.turn-container[data-mode="${mode}"][data-turn-id="${turnId}"]`
        );
    }

    private ensureTurnContainer(mode: Mode, turnId: string): HTMLElement | null {
        const container = this.ensureContainer();
        if (!container) return null;
        let turnEl = this.getTurnContainer(mode, turnId);
        if (!turnEl) {
            turnEl = document.createElement('div');
            turnEl.className = 'turn-container';
            turnEl.setAttribute('data-turn-id', turnId);
            turnEl.setAttribute('data-mode', mode);
            if (!this.isCurrentTab(mode)) {
                turnEl.classList.add('oa-hidden');
            }
            container.appendChild(turnEl);
        }
        return turnEl;
    }

    private findParentTurnContainer(el: HTMLElement | null | undefined): HTMLElement | null {
        if (!el) return null;
        let current: HTMLElement | null = el;
        while (current) {
            if (current.classList.contains('turn-container')) return current;
            current = current.parentElement;
        }
        return null;
    }

    private findReasoningBlock(mode: Mode, turnId?: string): HTMLElement | null {
        const container = this.ensureContainer();
        if (!container) return null;
        if (turnId) {
            const turnContainer = this.getTurnContainer(mode, turnId);
            if (turnContainer) {
                return turnContainer.querySelector(
                    `.reasoning-block[data-mode="${mode}"][data-turn-id="${turnId}"]`
                );
            }
            return container.querySelector(
                `.reasoning-block[data-mode="${mode}"][data-turn-id="${turnId}"]`
            );
        }
        return container.querySelector(`.reasoning-block[data-mode="${mode}"]`);
    }

    private findLastElementInTurn(mode: Mode, turnId: string): HTMLElement | undefined {
        const container = this.ensureContainer();
        if (!container) return undefined;
        const turnContainer = this.getTurnContainer(mode, turnId);
        const scope = turnContainer ?? container;
        const elements = Array.from(
            scope.querySelectorAll(`[data-mode="${mode}"][data-turn-id="${turnId}"]`)
        );
        if (elements.length === 0) return undefined;
        return elements[elements.length - 1] as HTMLElement;
    }

    private reorderTurnElements(mode: Mode, turnId: string): void {
        const container = this.ensureContainer();
        if (!container) return;
        const turnContainer = this.getTurnContainer(mode, turnId);
        const scope = turnContainer ?? container;

        const all = Array.from(
            scope.querySelectorAll(`[data-mode="${mode}"][data-turn-id="${turnId}"]`)
        );
        if (all.length === 0) return;

        const userEl = all.find((el) => el.classList.contains('user-message'));
        if (!userEl) return;

        const reasoningEl = all.find((el) => el.classList.contains('reasoning-block')) || undefined;
        const systemEls = all.filter((el) => el.classList.contains('system-message'));
        const stopEls = systemEls.filter((el) => el.classList.contains('stop-message'));
        const errorEls = systemEls.filter((el) => el.classList.contains('error-message'));
        const statusEls = systemEls.filter(
            (el) => !el.classList.contains('stop-message') && !el.classList.contains('error-message')
        );
        const assistantEls = all.filter(
            (el) =>
                el.classList.contains('assistant-message') &&
                !el.classList.contains('system-message') &&
                !el.classList.contains('result-message')
        );
        const resultEls = all.filter((el) => el.classList.contains('result-message'));

        const ordered = [
            reasoningEl,
            ...statusEls,
            ...assistantEls,
            ...resultEls,
            ...errorEls,
            ...stopEls
        ].filter(Boolean) as HTMLElement[];

        let anchor: HTMLElement = userEl as HTMLElement;
        ordered.forEach((el) => {
            if (el === anchor) return;
            if (el.parentNode !== scope) return;
            if (anchor.nextElementSibling === el) {
                anchor = el;
                return;
            }
            anchor.insertAdjacentElement('afterend', el);
            anchor = el;
        });
    }

    private finalizeResultMessage(
        el: HTMLElement | null,
        resultContent: string,
        mode: 'edit' | 'discuss' | 'web'
    ): void {
        const isEditMode = mode === 'edit';
        const editAttr = el?.getAttribute('data-edit-number');
        const editNumber = isEditMode ? (editAttr ? parseInt(editAttr, 10) || 0 : 0) : 0;
        const getPos = () => {
            return this.deps.getEditPositionMap().get(editNumber);
        };

        this.assistantMessageRenderer.finalizeResultMessage(el, resultContent, mode, getPos);
    }

    addWelcomeMessageForMode(mode: 'edit' | 'discuss' | 'web', title: string, buildBody: (em: HTMLElement) => void): void {
        const container = this.ensureContainer();
        if (!container) return;
        const hasMessages = container.querySelector(`.chat-message[data-mode="${mode}"]:not(.welcome-message)`);
        if (hasMessages) return;
        this.removeWelcomeMessages(mode);
        const msg = container.createEl('div', { cls: 'chat-message assistant-message welcome-message' });
        msg.setAttribute('data-mode', mode);
        const contentEl = msg.createEl('div', { cls: 'message-content welcome-content' });
        const titleP = contentEl.createEl('p', { cls: 'oa-welcome-title' });
        titleP.createEl('strong', { text: title });
        const bodyP = contentEl.createEl('p', { cls: 'oa-welcome-body' });
        const em = bodyP.createEl('em');
        buildBody(em);
    }

    addWelcomeMessages(): void {
        const container = this.ensureContainer();
        if (!container) return;
        // Clear existing welcome messages to avoid duplicates when re-adding
        this.removeWelcomeMessages('edit');
        this.removeWelcomeMessages('discuss');
        this.removeWelcomeMessages('web');

        const builders: Record<'edit' | 'discuss' | 'web', (em: HTMLElement) => void> = {
            edit: (em) => {
                em.appendText('In this tab, you suggest text for the chatbot to edit.');
                em.createEl('br'); em.createEl('br');
                em.appendText('The chatbot explains what it does, then offers edited text.');
                em.createEl('br'); em.createEl('br');
                const ul = em.createEl('ul', { cls: 'oa-welcome-list' });
                ul.createEl('li', { text: 'You can apply it to the same place in the note where it was taken from.' });
                ul.createEl('li', { text: 'You can also apply with history - original text will be saved under a spoiler.' });
                ul.createEl('li', { text: 'And you can also send the edited text to context to continue editing.' });
                em.createEl('br'); em.createEl('br');
                em.appendText('This mode requires selected context to work. History is completely disabled in this tab to avoid loading the model\'s memory.');
            },
            discuss: (em) => {
                em.appendText('In this tab, you can chat freely with the bot, or you can add context and discuss selected text.');
                em.createEl('br'); em.createEl('br');
                em.appendText('This chat has history - the bot doesn\'t forget the conversation context.');
            },
            web: (em) => {
                em.appendText('In this tab, you can search for information on the internet.');
                em.createEl('br'); em.createEl('br');
                em.appendText('Better for questions that need quick, factual answers rather than explanations.');
                em.createEl('br'); em.createEl('br');
                em.appendText('History and context are completely disabled in this chat to avoid loading the model\'s memory.');
            }
        };

        (Object.keys(builders) as Array<'edit' | 'discuss' | 'web'>).forEach((mode) => {
            const hasMessages = container.querySelector(`.chat-message[data-mode="${mode}"]:not(.welcome-message)`);
            if (!hasMessages) {
                this.addWelcomeMessageForMode(mode, '✦ About this tab', builders[mode]);
            }
        });
    }

    removeWelcomeMessages(mode: 'edit' | 'discuss' | 'web'): void {
        const container = this.ensureContainer();
        if (!container) return;
        const welcomeMessages = container.querySelectorAll(`.welcome-message[data-mode="${mode}"]`);
        welcomeMessages.forEach(msg => msg.remove());
        this.reasoningRenderer.clearBlock(mode);
    }

    clearTab(mode: 'edit' | 'discuss' | 'web'): void {
        const container = this.ensureContainer();
        if (!container) return;
        // Remove streaming and regular messages for the mode
        container.querySelectorAll(`.chat-message[data-mode="${mode}"]`).forEach(el => el.remove());
        // Remove reasoning blocks for the mode
        container.querySelectorAll(`.reasoning-block[data-mode="${mode}"]`).forEach(el => el.remove());
        // Remove turn containers for the mode
        container.querySelectorAll(`.turn-container[data-mode="${mode}"]`).forEach(el => el.remove());
        this.reasoningRenderer.clearBlock(mode);
        // Ensure welcome is re-added if tab is now empty
        this.addWelcomeMessages();
    }

    clearAllTabs(): void {
        const container = this.ensureContainer();
        if (!container) return;
        container.empty();
        container.querySelectorAll(`.turn-container`).forEach(el => el.remove());
        this.reasoningRenderer.clearBlock('edit');
        this.reasoningRenderer.clearBlock('discuss');
        this.reasoningRenderer.clearBlock('web');
        this.addWelcomeMessages();
    }

    private registerEventHandlers(eventBus: EventBus): void {
        const findById = (id?: string): HTMLElement | null => {
            if (!id) return null;
            return document.querySelector(`[data-msg-id="${id}"]`);
        };

        eventBus.on('render:addUserMessage', (data) => {
            const msgId = data.msgId || this.deps.generateMessageId();
            const turnId = data.turnId || msgId;
            const turnContainer = this.ensureTurnContainer(data.mode, turnId);
            this.removeWelcomeMessages(data.mode);

            const el = this.userMessageRenderer.createUserMessage(
                data.content,
                data.mode,
                msgId,
                data.contextContent,
                data.contextLabel
            );

            if (el) {
                el.setAttribute('data-msg-id', msgId);
                el._msgId = msgId;
                el.setAttribute('data-turn-id', turnId);
                if (turnContainer) {
                    turnContainer.appendChild(el);
                } else {
                    this.ensureContainer()?.appendChild(el);
                }
            }

            this.scrollToBottomIfNear();
        });

        eventBus.on('render:addUserMessageQueued', (data) => {
            const msgId = data.messageId || this.deps.generateMessageId();
            const turnId = data.turnId || msgId;
            const afterEl = findById(data.afterId || undefined) || undefined;
            const turnContainer = this.ensureTurnContainer(data.mode, turnId);
            this.removeWelcomeMessages(data.mode);

            const el = this.userMessageRenderer.createUserMessageQueued(
                data.content,
                data.mode,
                data.contextContent,
                data.contextLabel
            );

            el.setAttribute('data-msg-id', msgId);
            el._msgId = msgId;
            el.setAttribute('data-turn-id', turnId);

            if (turnContainer) {
                const afterTurn = this.findParentTurnContainer(afterEl);
                if (afterTurn && afterTurn !== turnContainer && afterTurn.parentNode) {
                    afterTurn.insertAdjacentElement('afterend', turnContainer);
                }
                turnContainer.appendChild(el);
            } else {
                this.ensureContainer()?.appendChild(el);
            }

            this.scrollToBottomIfNear();
        });

        eventBus.on('render:addSystemMessage', (data) => {
            let afterEl: HTMLElement | undefined = undefined;

            if (data.afterId) {
                afterEl = findById(data.afterId) || undefined;
                if (afterEl) {
                    console.debug('[MessageRenderer] Found afterId element:', data.afterId, 'element:', afterEl.className);
                }
            }

            const resolvedTurnId = data.turnId ||
                afterEl?.getAttribute('data-turn-id') ||
                afterEl?.getAttribute('data-msg-id') ||
                undefined;

            if (resolvedTurnId && (data.isStopMessage || data.isError)) {
                afterEl = this.findLastElementInTurn(data.mode, resolvedTurnId);
            } else if (resolvedTurnId && !afterEl) {
                afterEl = this.findLastElementInTurn(data.mode, resolvedTurnId);
            }

            if (!afterEl && data.afterId) {
                console.warn('[MessageRenderer] Could not find afterId element:', data.afterId, 'for system message:', data.content);
                if (resolvedTurnId) {
                    const container = this.ensureContainer();
                    if (container) {
                        const turnContainer = this.getTurnContainer(data.mode, resolvedTurnId);
                        const elementsWithTurnId = Array.from(
                            (turnContainer ?? container).querySelectorAll(`[data-turn-id="${resolvedTurnId}"][data-mode="${data.mode}"]`)
                        );
                        if (elementsWithTurnId.length > 0) {
                            afterEl = elementsWithTurnId[elementsWithTurnId.length - 1] as HTMLElement;
                            console.debug('[MessageRenderer] Found element by turnId:', afterEl.className, afterEl.getAttribute('data-msg-id'));
                        }
                    }
                }
            }
            
            const el = this.systemMessageRenderer.addSystemMessage(
                data.content,
                data.isStopMessage ?? false,
                data.mode,
                data.isError ?? false,
                afterEl
            );
            if (el && data.messageId) {
                el.setAttribute('data-msg-id', data.messageId);
                el._msgId = data.messageId;
            }
            if (el && resolvedTurnId) {
                el.setAttribute('data-turn-id', resolvedTurnId);
            }

            if (resolvedTurnId) {
                this.reorderTurnElements(data.mode, resolvedTurnId);
            }

            // Update Turn with system/error/stop message
            if (resolvedTurnId && this.deps.getTabState) {
                const tabState = this.deps.getTabState(data.mode);
                const turn = tabState.turns.find(t => t.id === resolvedTurnId);
                if (turn) {
                    const msgId = data.messageId || el?.getAttribute('data-msg-id') || this.deps.generateMessageId();
                    if (data.isError) {
                        addErrorToTurn(turn, msgId, data.content);
                    } else if (data.isStopMessage) {
                        // Stop message - always last
                        addStopMessageToTurn(turn, msgId, data.content);
                    } else {
                        // Regular system message (web status)
                        addSystemMessageToTurn(turn, msgId, data.content);
                    }
                    this.deps.syncTurnsToStore?.(data.mode);
                }
            }
        });

        eventBus.on('render:addStreamingMessage', (data) => {
            let afterEl = findById(data.afterId || undefined) || undefined;
            if (!afterEl && data.turnId) {
                afterEl = this.findLastElementInTurn(data.mode, data.turnId);
            }
            const el = this.assistantMessageRenderer.addStreamingMessage(data.isResult ?? false, data.mode, afterEl);
            if (el && data.messageId) {
                el.setAttribute('data-msg-id', data.messageId);
                el._msgId = data.messageId;
            }
            if (el && data.editNumber !== undefined && data.isResult) {
                el.setAttribute('data-edit-number', String(data.editNumber));
            }
            if (el && data.turnId) {
                el.setAttribute('data-turn-id', data.turnId);
            }
        });

        eventBus.on('render:updateStreamingMessage', (data) => {
            const el = findById(data.messageId);
            this.assistantMessageRenderer.updateStreamingMessage(el, data.content);
        });

        eventBus.on('render:finalizeStreamingMessage', (data) => {
            const el = findById(data.messageId);
            if (!el) return;
            if (data.mode === 'edit') {
                this.assistantMessageRenderer.finalizeStreamingMessage(el, data.content);
            } else {
                this.assistantMessageRenderer.finalizeDiscussMessage(el, data.content);
            }

            // Update Turn with assistant message
            if (data.turnId && this.deps.getTabState) {
                const tabState = this.deps.getTabState(data.mode);
                console.debug('[MessageRenderer] Looking for Turn:', data.turnId, 'in', tabState.turns.length, 'turns');
                const turn = tabState.turns.find(t => t.id === data.turnId);
                if (turn) {
                    addAssistantToTurn(turn, data.messageId, data.content, 'final');
                    console.debug('[MessageRenderer] Updated Turn with assistant message:', data.turnId);
                    this.deps.syncTurnsToStore?.(data.mode);
                } else {
                    console.warn('[MessageRenderer] Turn not found:', data.turnId);
                }
            } else {
                console.warn('[MessageRenderer] Missing turnId or getTabState');
            }
        });

        eventBus.on('render:finalizeResultMessage', (data) => {
            const el = findById(data.messageId);
            if (!el) return;
            if (data.editNumber !== undefined) {
                el.setAttribute('data-edit-number', String(data.editNumber));
            }
            this.finalizeResultMessage(el, data.resultContent, data.mode);

            // Update Turn with assistant message (Edit mode result)
            if (data.turnId && this.deps.getTabState) {
                const tabState = this.deps.getTabState(data.mode);
                const turn = tabState.turns.find(t => t.id === data.turnId);
                if (turn) {
                    const positionData = this.deps.getEditPositionMap().get(data.editNumber ?? 0);
                    addResultToTurn(
                        turn,
                        data.messageId,
                        data.resultContent,
                        'final',
                        data.editNumber,
                        positionData
                    );
                    console.debug('[MessageRenderer] Updated Turn with result message:', data.turnId);
                    this.deps.syncTurnsToStore?.(data.mode);
                }
            }
        });

        eventBus.on('render:finalizeExplanationMessage', (data) => {
            const el = findById(data.messageId);
            this.assistantMessageRenderer.finalizeExplanationMessage(el, data.content);

            // Update Turn with assistant message
            if (data.turnId && this.deps.getTabState) {
                const tabState = this.deps.getTabState(data.mode);
                const turn = tabState.turns.find(t => t.id === data.turnId);
                if (turn) {
                    addAssistantToTurn(turn, data.messageId, data.content, 'final');
                    console.debug('[MessageRenderer] Updated Turn with explanation message:', data.turnId);
                    this.deps.syncTurnsToStore?.(data.mode);
                }
            }
        });

        eventBus.on('render:addReasoningBlock', (data) => {
            console.debug('[MessageRenderer] Event render:addReasoningBlock received, mode:', data.mode);
            const afterEl = findById(data.afterId || undefined) || undefined;
            const block = this.reasoningRenderer.addReasoningBlock(
                afterEl,
                data.mode,
                data.appendToEnd,
                data.turnId,
                data.reasoningId
            );
            if (block && data.reasoningId) {
                block.setAttribute('data-msg-id', data.reasoningId);
                block._msgId = data.reasoningId;
            }
            this.reasoningRenderer.setBlock(data.mode, block);
            console.debug('[MessageRenderer] Reasoning block stored in reasoningRenderer for mode:', data.mode);
        });

        eventBus.on('render:updateReasoningBlock', (data) => {
            let existing = this.reasoningRenderer.getBlock(data.mode);
            const existingTurnId = existing?.getAttribute('data-turn-id');
            if (existing && data.turnId && existingTurnId && existingTurnId !== data.turnId) {
                existing = null;
            }
            let created = false;

            console.debug('[MessageRenderer] Event render:updateReasoningBlock, mode:', data.mode, 'exists:', !!existing);
            if (!existing || !existing.isConnected) {
                existing = this.findReasoningBlock(data.mode, data.turnId);
            }

            if (!existing || !existing.isConnected) {
                console.debug('[MessageRenderer] Creating reasoning block in updateReasoningBlock');
                const reasoningId = data.turnId ? `${data.turnId}-reasoning` : this.deps.generateMessageId();
                const afterEl = data.turnId ? findById(data.turnId) || undefined : undefined;
                existing = this.reasoningRenderer.addReasoningBlock(
                    afterEl,
                    data.mode,
                    undefined,
                    data.turnId,
                    reasoningId
                );
                created = true;
            }

            if (existing) {
                if (!existing.getAttribute('data-msg-id')) {
                    const reasoningId = data.turnId ? `${data.turnId}-reasoning` : this.deps.generateMessageId();
                    existing.setAttribute('data-msg-id', reasoningId);
                    existing._msgId = reasoningId;
                }
                if (data.turnId && !existing.getAttribute('data-turn-id')) {
                    existing.setAttribute('data-turn-id', data.turnId);
                }
                this.reasoningRenderer.setBlock(data.mode, existing);
                this.reasoningRenderer.applyStoredCollapsedState(existing, data.turnId);
                if (created && data.turnId && this.deps.getTabState) {
                    const tabState = this.deps.getTabState(data.mode);
                    const turn = tabState.turns.find(t => t.id === data.turnId);
                    if (turn?.reasoning) {
                        this.reasoningRenderer.setCollapsedState(existing, turn.reasoning.collapsed);
                    }
                }
                this.reasoningRenderer.updateReasoningBlock(existing, data.content);
            }

            if (data.turnId && this.deps.getTabState && data.mode !== 'web') {
                const tabState = this.deps.getTabState(data.mode);
                const turn = tabState.turns.find(t => t.id === data.turnId);
                if (turn) {
                    const trimmed = (data.content || '').trim();
                    if (trimmed) {
                        const reasoningId = existing?.getAttribute('data-msg-id') || `${data.turnId}-reasoning`;
                        const collapsed = existing?.classList.contains('collapsed') ?? true;
                        updateReasoningInTurn(turn, trimmed, collapsed, reasoningId);
                        this.deps.syncTurnsToStore?.(data.mode);
                    }
                }
            }

            if (created && data.turnId) {
                this.reorderTurnElements(data.mode, data.turnId);
            }
        });

        eventBus.on('render:finalizeReasoningBlock', (data) => {
            let existing = this.reasoningRenderer.getBlock(data.mode);
            const existingTurnId = existing?.getAttribute('data-turn-id');
            if (existing && data.turnId && existingTurnId && existingTurnId !== data.turnId) {
                existing = null;
            }
            if (!existing || !existing.isConnected) {
                existing = this.findReasoningBlock(data.mode, data.turnId);
            }

            console.debug('[MessageRenderer] Event render:finalizeReasoningBlock, mode:', data.mode, 'exists:', !!existing);
            if (!existing) {
                console.warn('[MessageRenderer] No reasoning block to finalize for mode:', data.mode);
                return;
            }

            this.reasoningRenderer.finalizeReasoningBlock(existing);

            if (data.turnId && this.deps.getTabState) {
                const tabState = this.deps.getTabState(data.mode);
                const turn = tabState.turns.find(t => t.id === data.turnId);
                if (turn) {
                    const reasoningText = extractTextFromReasoningHtml(existing.innerHTML);
                    const reasoningId = existing.getAttribute('data-msg-id') || `${data.turnId}-reasoning`;
                    const collapsed = existing.classList.contains('collapsed');
                    if (reasoningText) {
                        updateReasoningInTurn(turn, reasoningText, collapsed, reasoningId);
                        console.debug('[MessageRenderer] Updated Turn with reasoning:', data.turnId);
                        this.deps.syncTurnsToStore?.(data.mode);
                    }
                }
            }

            this.reasoningRenderer.clearBlock(data.mode);

            if (data.turnId) {
                this.reorderTurnElements(data.mode, data.turnId);
            }
        });

        eventBus.on('render:clearStreaming', (data) => {
            const container = document.getElementById('ollama-chat-messages');
            if (!container) return;
            container.querySelectorAll(`.streaming-message[data-mode="${data.mode}"]`).forEach(el => {
                const contentEl = el.querySelector('.message-content');
                if (contentEl) {
                    const cursor = contentEl.querySelector('.cursor-blink');
                    if (cursor) cursor.remove();
                }
                el.classList.remove('streaming-message');
            });
            let block = this.reasoningRenderer.getBlock(data.mode);
            if (!block || !block.isConnected) {
                block = this.findReasoningBlock(data.mode);
            }
            if (block && block.isConnected) {
                this.reasoningRenderer.finalizeReasoningBlock(block);

                const turnId = block.getAttribute('data-turn-id') || block._finalizedReasoningData?.turnId;
                if (turnId && this.deps.getTabState) {
                    const tabState = this.deps.getTabState(data.mode);
                    const turn = tabState.turns.find(t => t.id === turnId);
                    if (turn) {
                        const reasoningText = extractTextFromReasoningHtml(block.innerHTML);
                        const reasoningId = block.getAttribute('data-msg-id') || `${turnId}-reasoning`;
                        const collapsed = block.classList.contains('collapsed');
                        if (reasoningText) {
                            updateReasoningInTurn(turn, reasoningText, collapsed, reasoningId);
                            this.deps.syncTurnsToStore?.(data.mode);
                        }
                    }
                }
                if (turnId) {
                    this.reorderTurnElements(data.mode, turnId);
                }
            }
            this.reasoningRenderer.clearBlock(data.mode);
        });

        eventBus.on('render:addWelcomeMessages', () => {
            this.addWelcomeMessages();
        });

        eventBus.on('render:clearTab', (data) => {
            this.clearTab(data.mode);
        });

        eventBus.on('render:clearAllTabs', () => {
            this.clearAllTabs();
        });

        // === History restoration (Turn-based) ===
        eventBus.on('render:restoreTurn', (data) => {
            // Render single turn
            const container = this.ensureContainer();
            if (!container) return;

            const turnEl = this.turnRenderer.renderTurn(data.turn, data.mode);
            if (turnEl) {
                container.appendChild(turnEl);
            }
        });

        eventBus.on('render:restoreTurns', (data) => {
            // Render all turns for a mode
            this.turnRenderer.renderTurns(data.turns, data.mode);
        });
    }
}
