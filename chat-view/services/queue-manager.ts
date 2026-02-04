/**
 * QueueManager - request queue management
 * Extracted from RequestProcessor for simplicity and testing.
 * Event-Driven: processes queue sequentially.
 */

import type { QueuedRequest } from '../types';
import { Actions } from '../core/actions';
import type { Store } from '../core/store';
import type { TabState } from '../state/types';
import type { EventBus } from '../core/event-bus';

/**
 * Context interface for accessing required ChatView methods
 */
interface QueueManagerContext {
    // Tab state
    getCurrentTab(): 'edit' | 'discuss' | 'web';
    getCurrentTabState(): TabState;
    getTabState(mode: 'edit' | 'discuss' | 'web'): TabState;
    
    // Processing state
    isProcessing: boolean;
    setProcessingTab(tab: 'edit' | 'discuss' | 'web' | null): void;
    
    // Queue management
    getRequestQueue(): QueuedRequest[];
    setRequestQueue(queue: QueuedRequest[]): void;
    
    // UI methods
    updateTabIndicators(): void;
    clearSelectedText(): void;
    scrollToBottom(force?: boolean): void;

    // UI ports (DOM access must go through ChatView)
    getChatMessagesContainer(): HTMLElement | null;
    findChatElements(selector: string): HTMLElement[];
    findChatMessageElementById(messageId: string): HTMLElement | null;

    // ID generation
    generateMessageId(): string;

    // Event bus
    eventBus: Pick<EventBus, 'emit'>;

    // Store (for keeping textarea drafts in sync)
    store: Store;
    
}

export class QueueManager {
    constructor(private ctx: QueueManagerContext) {}

    /**
     * Add request to queue
     * Called when another request is being processed
     */
    addToQueue(message: string, textarea: HTMLTextAreaElement | null): void {
        const mode = this.ctx.getCurrentTab();
        const tabState = this.ctx.getCurrentTabState();

        // Save context BEFORE clearing anything
        const savedContext = {
            selectedText: tabState.selectedText,
            selectedTextStart: tabState.selectedTextStart,
            selectedTextEnd: tabState.selectedTextEnd,
            contextLabel: tabState.contextLabel
        };

        // Clear textarea
        if (textarea) {
            textarea.value = '';
        }

        // Clear saved textarea content for current mode
        tabState.textareaContent = '';
        Actions.clearTextareaContent(this.ctx.store, mode);

        // Find last element in this mode (including reasoning blocks) to insert after (via UI port)
        const allElementsInMode = this.ctx.findChatElements(
            `.chat-message[data-mode="${mode}"], .reasoning-block[data-mode="${mode}"]`
        );
        const lastElementInMode = allElementsInMode[allElementsInMode.length - 1] as HTMLElement | undefined;
        const afterId: string | undefined =
            lastElementInMode?._msgId ||
            lastElementInMode?.getAttribute('data-msg-id') ||
            undefined;

        // Add user message with "Queued" status (event-driven)
        const messageId = this.ctx.generateMessageId();
        this.ctx.eventBus.emit('render:addUserMessageQueued', {
            content: message,
            mode,
            afterId,
            messageId,
            contextContent: savedContext.selectedText,
            contextLabel: savedContext.contextLabel,
            turnId: messageId
        });

        const userMessageEl = this.ctx.findChatMessageElementById(messageId);
        if (!userMessageEl) {
            console.warn('[QueueManager] Failed to find queued user message element after render', messageId);
        }

        // Now clear selected context after creating the user message (only for non-web modes and if not pinned)
        if (mode !== 'web' && !tabState.isContextPinned) {
            this.ctx.clearSelectedText();
        }

        // Add to queue with saved context
        const queue = this.ctx.getRequestQueue();
        const chatContainer = this.ctx.getChatMessagesContainer();
        const fallbackDoc = userMessageEl?.ownerDocument ?? chatContainer?.ownerDocument;
        const fallbackUserMessageEl = fallbackDoc?.createElement('div') as HTMLElement | undefined;
        if (!fallbackUserMessageEl && !userMessageEl) {
            throw new Error('[QueueManager] Cannot create fallback userMessageEl (no ownerDocument available)');
        }
        queue.push({
            mode: mode,
            message: message,
            userMessageEl: userMessageEl ?? fallbackUserMessageEl!,
            savedContext: savedContext
        });
        this.ctx.setRequestQueue(queue);

        // Update tab indicators
        this.ctx.updateTabIndicators();

        // Scroll to show the queued message (force=true to bypass processingTab check)
        this.ctx.scrollToBottom(true);
    }

    /**
     * Process next request from queue
     * Returns QueuedRequest if available, or null if queue is empty
     *
     * IMPORTANT: Returned request contains savedContext that should be used
     * instead of current tabState during processing (don't restore to tabState!)
     */
    processNext(): QueuedRequest | null {
        const queue = this.ctx.getRequestQueue();
        
        if (queue.length === 0) {
            this.ctx.setProcessingTab(null);
            this.ctx.updateTabIndicators();
            return null;
        }

        const request = queue.shift()!;
        this.ctx.setRequestQueue(queue);

        // DON'T restore saved context to tabState - pass it via savedContext instead
        // This prevents the context from "reappearing" in UI when switching tabs
        // The context will be used directly in PromptBuilder via savedContext parameter

        // Remove "Queued" status from user message
        const queuedStatus = request.userMessageEl.querySelector('.queued-status');
        if (queuedStatus) {
            queuedStatus.remove();
        }

        return request;
    }

    /**
     * Get queue length
     */
    getQueueLength(): number {
        return this.ctx.getRequestQueue().length;
    }

    /**
     * Clear queue (e.g., on error)
     */
    clearQueue(): void {
        this.ctx.setRequestQueue([]);
        this.ctx.setProcessingTab(null);
        this.ctx.updateTabIndicators();
    }
}
