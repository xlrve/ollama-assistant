import { Notice } from 'obsidian';
import type { RequestProcessorContext } from './request-context';
import { QueueManager } from './queue-manager';
import type { QueuedRequest } from '../types';
import { Actions } from '../core/actions';

type Mode = 'edit' | 'discuss' | 'web';

type ProcessMessageFn = (
    message: string,
    textarea: HTMLTextAreaElement | null,
    mode: Mode,
    fromQueue?: boolean,
    userMessageEl?: HTMLElement | null,
    savedContext?: QueuedRequest['savedContext']
) => Promise<void>;

/**
 * RequestService - sending, queueing and finalizing requests.
 * Coordinator calls processing (RequestProcessor), manages flags/queue.
 */
export class RequestService {
    private queueManager: QueueManager;
    private processMessage: ProcessMessageFn;

    constructor(
        private ctx: RequestProcessorContext,
        processMessage: ProcessMessageFn
    ) {
        this.queueManager = new QueueManager(ctx);
        this.processMessage = processMessage;
    }

    /**
     * Public send method: validates, queues or starts processing.
     */
    async sendMessage(message: string, textarea: HTMLTextAreaElement | null) {
        if (!message.trim()) return;

        // Validation: Edit mode requires context
        if (this.ctx.getCurrentTab() === 'edit') {
            const hasContext = this.ctx.getCurrentTabState().selectedText &&
                              this.ctx.getCurrentTabState().selectedText.trim().length > 0;
            if (!hasContext) {
                new Notice('Edit mode requires context. Please select text first.');
                return;
            }
        }

        // If already processing, add to queue
        if (this.ctx.isProcessing) {
            this.queueManager.addToQueue(message, textarea);
            return;
        }

        // CRITICAL: Set processing flag IMMEDIATELY to prevent race condition
        // (before async processMessage starts, so rapid clicks go to queue)
        this.ctx.setProcessing(true);
        this.ctx.updateSendButtonState(true);
        Actions.startProcessing(this.ctx.store, this.ctx.getCurrentTab());

        this.ctx.eventBus.emit('generation:start', { tab: this.ctx.getCurrentTab(), message });

        // Start processing immediately
        await this.processMessage(message, textarea, this.ctx.getCurrentTab());
    }

    /**
     * Finalize processing + start queue.
     */
    async finalizeProcessing(lockedMode: Mode) {
        this.ctx.setProcessing(false);
        this.ctx.setCurrentAbortController(null);
        Actions.stopProcessing(this.ctx.store);
        Actions.setAbortController(this.ctx.store, null);
        this.ctx.updateSendButtonState(false);

        // Clear calculating flag and update buffer
        this.ctx.getTabStates()[lockedMode].isCalculating = false;
        Actions.setCalculating(this.ctx.store, lockedMode, false);

        // Update tab indicators
        this.ctx.updateTabIndicators();

        this.ctx.eventBus.emit('generation:completed', { tab: lockedMode });

        // Save chat history after message processing
        await this.ctx.saveChatHistory();

        // Process next request from queue
        const nextRequest = this.queueManager.processNext();
        if (nextRequest) {
            this.ctx.eventBus.emit('generation:start', { tab: nextRequest.mode, message: nextRequest.message });
            // For queued requests: pass userMessageEl and fromQueue=true with savedContext
            await this.processMessage(
                nextRequest.message,
                null,
                nextRequest.mode,
                true, // fromQueue - context already cleared
                nextRequest.userMessageEl,
                nextRequest.savedContext // Pass saved context instead of restoring to tabState
            );
        }
    }
}
