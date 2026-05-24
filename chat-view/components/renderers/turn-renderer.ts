import type { Turn } from '../../types';
import type { SystemMessageRenderer } from './system-message-renderer';
import type { UserMessageRenderer } from './user-message-renderer';
import type { AssistantMessageRenderer } from './assistant-message-renderer';
import { safeSetHtml } from '../../utils/dom-utils';

export type Mode = 'edit' | 'discuss' | 'web';

export type TurnRendererDeps = {
    getContainer: (mode: Mode) => HTMLElement | null;
    isCurrentTab: (targetMode: Mode) => boolean;
    scrollToBottomIfNear: () => void;
    userMessageRenderer: UserMessageRenderer;
    systemMessageRenderer: SystemMessageRenderer;
    assistantMessageRenderer: AssistantMessageRenderer;
    renderMarkdown: (markdown: string) => string;
    generateMessageId: () => string;
    removeWelcomeMessages?: (mode: Mode) => void;
    onReasoningToggle?: (mode: Mode, turnId: string, collapsed: boolean) => void;
};

/**
 * TurnRenderer - keyed renderer for rendering turns in order
 * Renders turns from normalized model, ensuring correct order
 */
export class TurnRenderer {
    // Map turnId -> DOM element for quick updates
    private turnElements: Map<string, HTMLElement> = new Map();

    constructor(private deps: TurnRendererDeps) {}

    /**
     * Renders list of turns into container
     * @param appendToExisting - if true, appends turns to existing elements instead of clearing
     */
    renderTurns(turns: Turn[], mode: Mode, appendToExisting: boolean = false): void {
        const container = this.deps.getContainer(mode);
        if (!container) return;

        // Remove welcome messages if we have turns
        if (turns.length > 0) {
            this.deps.removeWelcomeMessages?.(mode);
        }

        // Create Map of existing elements
        const existingElements = new Map<string, HTMLElement>();
        Array.from(container.children).forEach((el) => {
            const turnId = (el as HTMLElement).getAttribute('data-turn-id');
            const elMode = (el as HTMLElement).getAttribute('data-mode');
            if (turnId && elMode === mode) {
                existingElements.set(turnId, el as HTMLElement);
            }
        });

        // Render turns in order
        const renderedTurnIds = new Set<string>();

        turns.forEach((turn) => {
            const existingEl = existingElements.get(turn.id);
            if (existingEl && this.isTurnUpToDate(existingEl, turn)) {
                // Element exists and is up to date - leave as is
                renderedTurnIds.add(turn.id);
            } else {
                // Create new element or update existing
                const turnEl = this.renderTurn(turn, mode, existingEl);
                if (turnEl) {
                    if (!existingEl) {
                        // New element - add to container
                        container.appendChild(turnEl);
                    }
                    renderedTurnIds.add(turn.id);
                    this.turnElements.set(turn.id, turnEl);
                }
            }
        });

        // Remove turn elements that no longer exist (only if not appendToExisting)
        if (!appendToExisting) {
            existingElements.forEach((el, turnId) => {
                if (!renderedTurnIds.has(turnId)) {
                    el.remove();
                    this.turnElements.delete(turnId);
                }
            });
        }

        // Apply display for inactive tabs - set on each element
        const allElements = container.querySelectorAll(`[data-mode="${mode}"]`);
        allElements.forEach((el) => {
            (el as HTMLElement).toggleClass('oa-hidden', !this.deps.isCurrentTab(mode));
        });

        this.deps.scrollToBottomIfNear();
    }

    /**
     * Renders one turn (public for use in event handlers)
     */
    renderTurn(turn: Turn, mode: Mode, existingEl?: HTMLElement): HTMLElement | null {
        const container = this.deps.getContainer(mode);
        if (!container) return null;

        // Create container for turn
        const turnContainer = existingEl || document.createElement('div');
        turnContainer.className = 'turn-container';
        turnContainer.setAttribute('data-turn-id', turn.id);
        turnContainer.setAttribute('data-mode', mode);

        // Clear content (if updating)
        if (existingEl) {
            turnContainer.empty();
        }

        // 1. User message - use originalMessage if available (without context prefix)
        const displayText = turn.user.originalMessage || turn.user.content;
        const userEl = this.deps.userMessageRenderer.createUserMessage(
            displayText,
            mode,
            turn.user.id,
            turn.user.contextContent,
            turn.user.contextLabel
        );
        userEl.setAttribute('data-turn-id', turn.id);
        turnContainer.appendChild(userEl);

        // 2. Reasoning (optional)
        if (turn.reasoning) {
            const reasoningEl = this.renderReasoningBlock(turn.reasoning, mode, turn.id);
            if (reasoningEl) {
                turnContainer.appendChild(reasoningEl);
            }
        }

        // 3. System messages (for web mode - live statuses, go BEFORE response)
        turn.systemMessages.forEach((sysMsg) => {
            const sysEl = this.deps.systemMessageRenderer.createSystemMessage(
                sysMsg.content,
                false, // not stop message
                mode,
                false // not error
            );
            sysEl.setAttribute('data-turn-id', turn.id);
            sysEl.setAttribute('data-msg-id', sysMsg.id);
            turnContainer.appendChild(sysEl);
        });

        // 4. Assistant message
        if (turn.assistant) {
            const assistantEl = this.renderAssistantMessage(turn.assistant, turn, mode);
            if (assistantEl) {
                turnContainer.appendChild(assistantEl);
            }
        }

        // 4.1 Edit result message
        if (turn.result) {
            const resultEl = this.renderResultMessage(turn.result, turn, mode);
            if (resultEl) {
                turnContainer.appendChild(resultEl);
            }
        }

        // 5. Error messages (can be multiple)
        turn.errors.forEach((error) => {
            const errorEl = this.deps.systemMessageRenderer.createSystemMessage(
                error.content,
                false,
                mode,
                true // is error
            );
            errorEl.setAttribute('data-turn-id', turn.id);
            errorEl.setAttribute('data-msg-id', error.id);
            turnContainer.appendChild(errorEl);
        });

        // 6. Stop message (ALWAYS last)
        if (turn.stopMessage) {
            const stopEl = this.deps.systemMessageRenderer.createSystemMessage(
                turn.stopMessage.content,
                true, // is stop message
                mode,
                false // not error
            );
            stopEl.setAttribute('data-turn-id', turn.id);
            stopEl.setAttribute('data-msg-id', turn.stopMessage.id);
            turnContainer.appendChild(stopEl);
        }

        return turnContainer;
    }

    /**
     * Renders reasoning block
     */
    private renderReasoningBlock(
        reasoning: Turn['reasoning'],
        mode: Mode,
        turnId: string
    ): HTMLElement | null {
        if (!reasoning) return null;

        const blockEl = document.createElement('div');
        blockEl.className = reasoning.collapsed ? 'reasoning-block collapsed' : 'reasoning-block';
        blockEl.setAttribute('data-mode', mode);
        blockEl.setAttribute('data-turn-id', turnId);
        blockEl.setAttribute('data-msg-id', reasoning.id);
        blockEl.setAttribute('data-collapsed', reasoning.collapsed ? '1' : '0');

        const headerEl = document.createElement('div');
        headerEl.className = 'reasoning-header';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'reasoning-toggle';
        toggleBtn.textContent = reasoning.collapsed ? 'Show reasoning' : 'Hide reasoning';
        toggleBtn.type = 'button';

        const toggle = () => {
            if (blockEl.classList.contains('collapsed')) {
                blockEl.classList.remove('collapsed');
                toggleBtn.textContent = 'Hide reasoning';
                blockEl.setAttribute('data-collapsed', '0');
            } else {
                blockEl.classList.add('collapsed');
                toggleBtn.textContent = 'Show reasoning';
                blockEl.setAttribute('data-collapsed', '1');
            }
            reasoning.collapsed = blockEl.classList.contains('collapsed');
            this.deps.onReasoningToggle?.(mode, turnId, reasoning.collapsed);
        };
        const handleToggle = (event: Event) => {
            const target = event.target as HTMLElement | null;
            if (!target || !target.closest('.reasoning-header')) return;
            event.preventDefault();
            event.stopPropagation();
            toggle();
        };
        blockEl.addEventListener('pointerdown', handleToggle, true);

        const contentEl = document.createElement('div');
        contentEl.className = 'reasoning-content';
        const escaped = reasoning.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/\n/g, '<br>');
        safeSetHtml(contentEl, escaped);

        headerEl.appendChild(toggleBtn);
        blockEl.appendChild(headerEl);
        blockEl.appendChild(contentEl);

        return blockEl;
    }

    /**
     * Renders assistant message
     */
    private renderAssistantMessage(
        assistant: NonNullable<Turn['assistant']>,
        turn: Turn,
        mode: Mode
    ): HTMLElement | null {
        const container = this.deps.getContainer(mode);
        if (!container) return null;

        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message assistant-message';
        messageEl.setAttribute('data-mode', mode);
        messageEl.setAttribute('data-turn-id', turn.id);
        messageEl.setAttribute('data-msg-id', assistant.id);

        // Restored messages render as final (no streaming cursor).

        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        safeSetHtml(contentEl, this.deps.renderMarkdown(assistant.content));
        messageEl.appendChild(contentEl);

        // Add model warning for edit mode if response doesn't contain <EDIT> tag
        // This means the model didn't follow the expected format
        // BUT: don't show warning if generation was stopped by user (stopMessage exists)
        if (mode === 'edit' && !turn.result && !assistant.content.includes('<EDIT>') && !turn.stopMessage) {
            const warningContainer = document.createElement('div');
            warningContainer.className = 'model-warning';
            const iconEl = document.createElement('span');
            iconEl.className = 'warning-icon';
            iconEl.textContent = '⚠';
            warningContainer.appendChild(iconEl);
            const textEl = document.createElement('span');
            textEl.className = 'warning-text';
            textEl.textContent = 'The model failed to process your request. The selected model may be too weak for this mode, or try rephrasing your request.';
            warningContainer.appendChild(textEl);
            messageEl.appendChild(warningContainer);
        }

        return messageEl;
    }

    /**
     * Renders edit result message
     */
    private renderResultMessage(
        result: NonNullable<Turn['result']>,
        turn: Turn,
        mode: Mode
    ): HTMLElement | null {
        const container = this.deps.getContainer(mode);
        if (!container) return null;

        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message assistant-message result-message';
        messageEl.setAttribute('data-mode', mode);
        messageEl.setAttribute('data-turn-id', turn.id);
        messageEl.setAttribute('data-msg-id', result.id);
        if (result.editNumber !== undefined) {
            messageEl.setAttribute('data-edit-number', String(result.editNumber));
        }

        // Restored messages render as final (no streaming cursor).

        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        safeSetHtml(contentEl, this.deps.renderMarkdown(result.content));
        messageEl.appendChild(contentEl);

        // Add Apply/Keep/Add-to-context buttons for final results in edit mode
        if (mode === 'edit' && result.status === 'final' && result.editNumber !== undefined) {
            this.deps.assistantMessageRenderer.attachResultButtons(
                messageEl,
                result.editNumber,
                result.content,
                result.positionData
            );
        }

        return messageEl;
    }

    /**
     * Checks if existing element is up to date for turn
     */
    private isTurnUpToDate(el: HTMLElement, turn: Turn): boolean {
        // Simple check - if turn.id matches, consider up to date
        return el.getAttribute('data-turn-id') === turn.id;
    }

    /**
     * Updates one turn (for incremental updates)
     */
    updateTurn(turn: Turn, mode: Mode): void {
        const existingEl = this.turnElements.get(turn.id);
        if (existingEl) {
            // Update existing element
            const updatedEl = this.renderTurn(turn, mode, existingEl);
            if (updatedEl) {
                this.turnElements.set(turn.id, updatedEl);
            }
        }
        // If turn doesn't exist - need to re-render all turns (should be called externally)
    }
}

