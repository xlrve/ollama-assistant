export type Mode = 'edit' | 'discuss' | 'web';

export interface ReasoningRendererDeps {
    ensureContainer: () => HTMLElement | null;
    isCurrentTab: (targetMode: Mode) => boolean;
    scrollToBottomIfNear: () => void;
    streamingCursor: string;
}

/**
 * ReasoningRenderer
 * Creates, updates and finalizes reasoning blocks.
 * Stores references to active reasoning blocks by mode.
 */
export class ReasoningRenderer {
    private reasoningBlocks: Record<Mode, HTMLElement | null> = {
        edit: null,
        discuss: null,
        web: null
    };
    private collapsedByKey: Map<string, boolean> = new Map();

    constructor(private deps: ReasoningRendererDeps) {}

    getBlock(mode: Mode): HTMLElement | null {
        return this.reasoningBlocks[mode];
    }

    setBlock(mode: Mode, el: HTMLElement | null): void {
        this.reasoningBlocks[mode] = el;
    }

    clearBlock(mode: Mode): void {
        this.reasoningBlocks[mode] = null;
    }

    private resolveKey(el: HTMLElement | null, fallback?: string): string | null {
        if (!el) return fallback ?? null;
        return el.getAttribute('data-turn-id') ||
            el.getAttribute('data-msg-id') ||
            el._msgId ||
            fallback ||
            null;
    }

    setCollapsedState(el: HTMLElement | null, collapsed: boolean): void {
        if (!el) return;
        const toggleBtn = el.querySelector('.reasoning-toggle');
        if (collapsed) {
            el.classList.add('collapsed');
            el.setAttribute('data-collapsed', '1');
            if (toggleBtn) toggleBtn.textContent = 'Show reasoning';
        } else {
            el.classList.remove('collapsed');
            el.setAttribute('data-collapsed', '0');
            if (toggleBtn) toggleBtn.textContent = 'Hide reasoning';
        }
    }

    applyStoredCollapsedState(el: HTMLElement | null, fallbackKey?: string): void {
        if (!el) return;
        const key = this.resolveKey(el, fallbackKey);
        if (!key) return;
        const stored = this.collapsedByKey.get(key);
        if (stored === undefined) return;
        this.setCollapsedState(el, stored);
    }

    addReasoningBlock(
        afterElement?: HTMLElement,
        mode: Mode = 'edit',
        appendToEnd?: boolean,
        turnId?: string,
        reasoningId?: string
    ): HTMLElement | null {
        const container = this.deps.ensureContainer();
        if (!container) return null;

        console.debug('[MessageRenderer] addReasoningBlock called, mode:', mode);

        const resolvedTurnId =
            turnId ||
            afterElement?.getAttribute('data-turn-id') ||
            afterElement?.getAttribute('data-msg-id') ||
            undefined;
        const resolvedReasoningId = reasoningId || (resolvedTurnId ? `${resolvedTurnId}-reasoning` : undefined);

        const blockEl = document.createElement('div');
        blockEl.className = 'reasoning-block collapsed';
        blockEl.setAttribute('data-mode', mode);
        blockEl.setAttribute('data-collapsed', '1');
        if (resolvedTurnId) {
            blockEl.setAttribute('data-turn-id', resolvedTurnId);
        }
        if (resolvedReasoningId) {
            blockEl.setAttribute('data-msg-id', resolvedReasoningId);
            blockEl._msgId = resolvedReasoningId;
        }

        const headerEl = document.createElement('div');
        headerEl.className = 'reasoning-header';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'reasoning-toggle';
        toggleBtn.textContent = 'Show reasoning';
        toggleBtn.type = 'button';

        const contentEl = document.createElement('div');
        contentEl.className = 'reasoning-content';

        const toggle = () => {
            if (blockEl.classList.contains('collapsed')) {
                this.setCollapsedState(blockEl, false);
            } else {
                this.setCollapsedState(blockEl, true);
            }
            const key = this.resolveKey(blockEl, resolvedTurnId || resolvedReasoningId);
            if (key) {
                this.collapsedByKey.set(key, blockEl.classList.contains('collapsed'));
            }
        };
        const handleToggle = (event: Event) => {
            const target = event.target as HTMLElement | null;
            if (!target || !target.closest('.reasoning-header')) return;
            event.preventDefault();
            event.stopPropagation();
            toggle();
        };
        blockEl.addEventListener('pointerdown', handleToggle, true);

        headerEl.appendChild(toggleBtn);
        blockEl.appendChild(headerEl);
        blockEl.appendChild(contentEl);

        if (!this.deps.isCurrentTab(mode)) {
            blockEl.classList.add('oa-hidden');
        }

        let targetContainer: HTMLElement = container;
        if (resolvedTurnId) {
            const turnContainer = container.querySelector(
                `.turn-container[data-mode="${mode}"][data-turn-id="${resolvedTurnId}"]`
            );
            if (turnContainer) {
                targetContainer = turnContainer as HTMLElement;
            }

            const stopEl = targetContainer.querySelector(
                `.system-message.stop-message[data-mode="${mode}"][data-turn-id="${resolvedTurnId}"]`
            );
            if (stopEl && stopEl.parentNode) {
                stopEl.parentNode.insertBefore(blockEl, stopEl);
                this.deps.scrollToBottomIfNear();
                console.debug('[MessageRenderer] Reasoning block inserted before stop message');
                return blockEl;
            }
        }

        if (appendToEnd) {
            targetContainer.appendChild(blockEl);
        } else if (afterElement && afterElement.parentNode) {
            afterElement.insertAdjacentElement('afterend', blockEl);
        } else if (targetContainer !== container) {
            targetContainer.appendChild(blockEl);
        } else {
            const userMessages = Array.from(container.querySelectorAll(`.user-message[data-mode="${mode}"]`));
            const lastActiveUserMessage = userMessages.reverse().find(msg => !msg.querySelector('.queued-status'));
            if (lastActiveUserMessage && (lastActiveUserMessage as HTMLElement).nextSibling) {
                container.insertBefore(blockEl, (lastActiveUserMessage as HTMLElement).nextSibling);
            } else if (lastActiveUserMessage) {
                container.appendChild(blockEl);
            } else {
                container.appendChild(blockEl);
            }
        }

        this.applyStoredCollapsedState(blockEl, resolvedTurnId || resolvedReasoningId);
        this.deps.scrollToBottomIfNear();
        console.debug('[MessageRenderer] Reasoning block created and added to DOM');
        return blockEl;
    }

    updateReasoningBlock(el: HTMLElement | null, content: string): void {
        if (!el) return;
        const contentEl = el.querySelector('.reasoning-content');
        if (!contentEl) return;

        const shouldAutoScroll = !el.classList.contains('collapsed') &&
            (contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 24);
        let textEl = contentEl.querySelector('.reasoning-text');
        let cursorEl = contentEl.querySelector('.cursor-blink');
        if (!textEl) {
            contentEl.empty();
            textEl = document.createElement('span');
            textEl.className = 'reasoning-text';
            contentEl.appendChild(textEl);
        }
        if (!cursorEl) {
            cursorEl = document.createElement('span');
            cursorEl.className = 'cursor-blink';
            cursorEl.textContent = this.deps.streamingCursor;
            contentEl.appendChild(cursorEl);
        }

        textEl.textContent = content || '';
        if (cursorEl.textContent !== this.deps.streamingCursor) {
            cursorEl.textContent = this.deps.streamingCursor;
        }
        if (shouldAutoScroll) {
            contentEl.scrollTop = contentEl.scrollHeight;
        }
        const container = this.deps.ensureContainer();
        if (container) {
            const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (distance <= 1) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }

    finalizeReasoningBlock(el: HTMLElement | null): void {
        if (!el) return;
        const contentEl = el.querySelector('.reasoning-content');
        if (contentEl) {
            const cursor = contentEl.querySelector('.cursor-blink');
            if (cursor) cursor.remove();
        }
        const collapsed = el.classList.contains('collapsed');
        this.setCollapsedState(el, collapsed);

        const mode = el.getAttribute('data-mode') as Mode;
        if (mode) {
            console.debug('[MessageRenderer] Finalizing reasoning block for mode:', mode);
            const turnId = el.getAttribute('data-turn-id') || undefined;
            el._finalizedReasoningData = {
                html: el.innerHTML,
                collapsed: el.classList.contains('collapsed'),
                mode,
                turnId
            };
            console.debug('[MessageRenderer] Saved reasoning data:', el._finalizedReasoningData);
        }
    }
}
