export type Mode = 'edit' | 'discuss' | 'web';

export interface UserMessageRendererDeps {
    ensureContainer: () => HTMLElement | null;
    isCurrentTab: (targetMode: Mode) => boolean;
    removeWelcomeMessages: (mode: Mode) => void;
    scrollToBottomIfNear: () => void;
    generateMessageId: () => string;
    getTooltipHandler: () => ((el: HTMLElement, text: string) => void) | undefined;
}

/**
 * UserMessageRenderer
 * Renders user messages (regular and queued)
 */
export class UserMessageRenderer {
    constructor(private deps: UserMessageRendererDeps) {}

    private resolveContextLabelText(targetMode: Mode, contextContent?: string, contextLabelOverride?: string): string {
        if (contextLabelOverride && contextLabelOverride.trim().length > 0) return contextLabelOverride;
        if (targetMode === 'web') return 'No context';
        if (contextContent && contextContent.trim().length > 0) return 'Lines ?';
        return 'No context';
    }

    /**
     * Creates a user message element WITHOUT adding to container.
     * Used by TurnRenderer for history restoration.
     */
    createUserMessage(
        content: string,
        mode: Mode,
        msgId: string,
        contextContent?: string,
        contextLabelOverride?: string
    ): HTMLElement {
        const messageEl = createDiv();
        messageEl.className = 'chat-message user-message';
        messageEl.setAttribute('data-mode', mode);
        messageEl.setAttribute('data-msg-id', msgId);

        if (!this.deps.isCurrentTab(mode)) {
            messageEl.addClass('oa-hidden');
        }

        const contextText = this.resolveContextLabelText(mode, contextContent, contextLabelOverride);

        const contextLabel = messageEl.createDiv({ cls: 'user-message-context' }) as HTMLElement;
        contextLabel.createSpan({ cls: 'context-arrow', text: '\u25B6' });
        contextLabel.createSpan({ cls: 'context-label', text: 'Ctx:' });
        contextLabel.createSpan({ text: ` ${contextText}` });

        const contextInfo = contextLabel.createSpan({ cls: 'user-context-info-icon', text: '\u24D8' });
        const hasContext =
            (contextContent && contextContent.trim().length > 0) ||
            (mode !== 'web' && contextText && contextText.trim().toLowerCase() !== 'no context');

        if (hasContext) {
            contextInfo.addClass('is-visible');
            const tooltipText = contextContent || contextText || '';
            const fn = this.deps.getTooltipHandler();
            if (fn) fn(contextInfo, tooltipText);
        } else {
            contextInfo.removeClass('is-visible');
        }

        messageEl.createDiv({ cls: 'message-content', text: content });
        return messageEl;
    }

    /**
     * Creates a queued user message element WITHOUT adding to container.
     * Used by MessageRenderer for turn-container rendering.
     */
    createUserMessageQueued(
        content: string,
        mode: Mode,
        contextContent?: string,
        contextLabelOverride?: string
    ): HTMLElement {
        const messageEl = createDiv();
        messageEl.className = 'chat-message user-message';
        messageEl.setAttribute('data-mode', mode);

        if (!this.deps.isCurrentTab(mode)) {
            messageEl.addClass('oa-hidden');
        }

        const contextText = this.resolveContextLabelText(mode, contextContent, contextLabelOverride);

        const contextLabel = messageEl.createDiv({ cls: 'user-message-context' }) as HTMLElement;
        contextLabel.createSpan({ cls: 'context-arrow', text: '\u25B6' });
        contextLabel.createSpan({ cls: 'context-label', text: 'Ctx:' });
        contextLabel.createSpan({ text: ` ${contextText}` });

        const contextInfo = contextLabel.createSpan({ cls: 'user-context-info-icon', text: '\u24D8' });
        const hasContext =
            (contextContent && contextContent.trim().length > 0) ||
            (mode !== 'web' && contextText && contextText.trim().toLowerCase() !== 'no context');

        if (hasContext) {
            contextInfo.addClass('is-visible');
            const tooltipText = contextContent || contextText || '';
            const fn = this.deps.getTooltipHandler();
            if (fn) fn(contextInfo, tooltipText);
        } else {
            contextInfo.removeClass('is-visible');
        }

        const contentWrapper = messageEl.createDiv({ cls: 'user-message-content-wrapper' }) as HTMLElement;
        contentWrapper.createDiv({ cls: 'message-content', text: content });
        const queuedStatus = contentWrapper.createDiv({ cls: 'queued-status' }) as HTMLElement;
        queuedStatus.createSpan({ cls: 'spinner' });
        queuedStatus.createSpan({ cls: 'queued-text', text: 'Queued' });

        return messageEl;
    }

    addUserMessage(
        content: string,
        mode?: Mode,
        msgId?: string,
        contextContent?: string,
        attachTooltipFn?: (el: HTMLElement, text: string) => void,
        contextLabelOverride?: string
    ): HTMLElement | null {
        const container = this.deps.ensureContainer();
        if (!container) return null;

        const targetMode = mode || 'edit';
        this.deps.removeWelcomeMessages(targetMode);

        const messageEl = container.createDiv({ cls: 'chat-message user-message' }) as HTMLElement;
        messageEl.setAttribute('data-mode', targetMode);

        if (!this.deps.isCurrentTab(targetMode)) {
            messageEl.addClass('oa-hidden');
        }

        const id = msgId || this.deps.generateMessageId();
        messageEl.setAttribute('data-msg-id', id);

        const contextText = this.resolveContextLabelText(targetMode, contextContent, contextLabelOverride);

        const contextLabel = messageEl.createDiv({ cls: 'user-message-context' }) as HTMLElement;
        contextLabel.createSpan({ cls: 'context-arrow', text: '\u25B6' });
        contextLabel.createSpan({ cls: 'context-label', text: 'Ctx:' });
        contextLabel.createSpan({ text: ` ${contextText}` });

        const contextInfo = contextLabel.createSpan({ cls: 'user-context-info-icon', text: '\u24D8' });
        const hasContext =
            (contextContent && contextContent.trim().length > 0) ||
            (targetMode !== 'web' && contextText && contextText.trim().toLowerCase() !== 'no context');

        if (hasContext) {
            contextInfo.addClass('is-visible');
            const tooltipText = contextContent || contextText || '';
            const fn = attachTooltipFn || this.deps.getTooltipHandler();
            if (fn) fn(contextInfo, tooltipText);
        } else {
            contextInfo.removeClass('is-visible');
        }

        messageEl.createDiv({ cls: 'message-content', text: content });
        this.deps.scrollToBottomIfNear();

        return messageEl;
    }

    addUserMessageQueued(
        content: string,
        mode: Mode,
        afterElement?: HTMLElement,
        contextContent?: string,
        attachTooltipFn?: (el: HTMLElement, text: string) => void,
        contextLabelOverride?: string
    ): HTMLElement {
        const container = this.deps.ensureContainer();
        if (!container) return createDiv();

        const targetMode = mode || 'edit';

        const welcomeMessages = container.querySelectorAll(`.welcome-message[data-mode="${targetMode}"]`);
        welcomeMessages.forEach((msg) => msg.remove());

        const messageEl = createDiv();
        messageEl.className = 'chat-message user-message';
        messageEl.setAttribute('data-mode', targetMode);

        if (!this.deps.isCurrentTab(targetMode)) {
            messageEl.addClass('oa-hidden');
        }

        const contextText = this.resolveContextLabelText(targetMode, contextContent, contextLabelOverride);

        const contextLabel = messageEl.createDiv({ cls: 'user-message-context' }) as HTMLElement;
        contextLabel.createSpan({ cls: 'context-arrow', text: '\u25B6' });
        contextLabel.createSpan({ cls: 'context-label', text: 'Ctx:' });
        contextLabel.createSpan({ text: ` ${contextText}` });

        const contextInfo = contextLabel.createSpan({ cls: 'user-context-info-icon', text: '\u24D8' });
        const hasContext =
            (contextContent && contextContent.trim().length > 0) ||
            (targetMode !== 'web' && contextText && contextText.trim().toLowerCase() !== 'no context');

        if (hasContext) {
            contextInfo.addClass('is-visible');
            const tooltipText = contextContent || contextText || '';
            const fn = attachTooltipFn || this.deps.getTooltipHandler();
            if (fn) fn(contextInfo, tooltipText);
        } else {
            contextInfo.removeClass('is-visible');
        }

        const contentWrapper = messageEl.createDiv({ cls: 'user-message-content-wrapper' }) as HTMLElement;
        contentWrapper.createDiv({ cls: 'message-content', text: content });
        const queuedStatus = contentWrapper.createDiv({ cls: 'queued-status' }) as HTMLElement;
        queuedStatus.createSpan({ cls: 'spinner' });
        queuedStatus.createSpan({ cls: 'queued-text', text: 'Queued' });

        if (afterElement && afterElement.parentNode) {
            afterElement.insertAdjacentElement('afterend', messageEl);
        } else {
            container.appendChild(messageEl);
        }

        this.deps.scrollToBottomIfNear();
        return messageEl;
    }
}
