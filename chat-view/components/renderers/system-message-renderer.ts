export type Mode = 'edit' | 'discuss' | 'web';

export interface SystemMessageRendererDeps {
    ensureContainer: () => HTMLElement | null;
    isCurrentTab: (targetMode: Mode) => boolean;
    scrollToBottomIfNear: () => void;
    generateMessageId: () => string;
}

/**
 * SystemMessageRenderer
 * Renders system messages (stop/error/regular)
 */
export class SystemMessageRenderer {
    constructor(private deps: SystemMessageRendererDeps) {}

    /**
     * Creates a system message element WITHOUT adding to container.
     * Used by TurnRenderer for history restoration.
     */
    createSystemMessage(
        content: string,
        isStopMessage: boolean,
        mode: Mode,
        isError: boolean,
        messageId?: string
    ): HTMLElement {
        const el = document.createElement('div');
        const baseClass = 'chat-message assistant-message system-message';
        const extraClass = isStopMessage ? ' stop-message' : isError ? ' error-message' : '';
        el.className = `${baseClass}${extraClass}`;
        el.setAttribute('data-mode', mode);

        const msgId = messageId || this.deps.generateMessageId();
        el.setAttribute('data-msg-id', msgId);

        if (!this.deps.isCurrentTab(mode)) {
            el.classList.add('oa-hidden');
        }

        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';

        if (isStopMessage) {
            const icon = document.createElement('span');
            icon.className = 'system-stop-icon';
            icon.textContent = '■';
            contentEl.appendChild(icon);
            contentEl.appendChild(document.createTextNode(' '));
        }

        contentEl.appendChild(document.createTextNode(content));
        el.appendChild(contentEl);

        return el;
    }

    addSystemMessage(
        content: string,
        isStopMessage: boolean,
        mode: Mode,
        isError: boolean,
        afterElement?: HTMLElement
    ): HTMLElement | null {
        const targetMode = mode || 'edit';

        const container = this.deps.ensureContainer();
        if (!container) return null;

        let insertAfter: HTMLElement | undefined = afterElement || undefined;
        if (!insertAfter) {
            const candidates = Array.from(container.querySelectorAll('.chat-message, .reasoning-block'))
                .filter((el) => el.getAttribute('data-mode') === targetMode) as HTMLElement[];
            insertAfter = candidates[candidates.length - 1];
        }

        const el = this.createSystemMessage(
            content,
            isStopMessage,
            targetMode,
            isError,
            this.deps.generateMessageId()
        );

        if (el) {
            if (!this.deps.isCurrentTab(targetMode)) {
                el.classList.add('oa-hidden');
            }

            if (insertAfter && insertAfter.parentNode) {
                insertAfter.insertAdjacentElement('afterend', el);
            } else {
                container.appendChild(el);
            }

            this.deps.scrollToBottomIfNear();
        }

        return el;
    }
}
