import type { TabState } from '../types';
import type { RequestProcessorContext } from './request-context';
import { StreamingHandler } from './streaming-handler';
import { MarkdownUtils } from '../markdown-utils';
import { Actions } from '../core/actions';
import type { OllamaMessage } from '../../ollama-client';
import { addAssistantToTurn, updateAssistantContent, updateAssistantStatus, addReasoningToTurn } from '../utils/turn-builder';

/**
 * EditDiscussHandler - handles generation for Edit and Discuss modes
 */
export class EditDiscussHandler {
    constructor(
        private ctx: RequestProcessorContext,
        private streamingHandler: StreamingHandler
    ) {}

    async processEditDiscuss(
        messages: OllamaMessage[],
        lockedMode: 'edit' | 'discuss',
        lockedTabState: TabState,
        userMessageEl: HTMLElement | null | undefined,
        isEditMode: boolean,
        abortController: AbortController,
        turnId: string
    ): Promise<void> {
        const eventBus = this.ctx.eventBus;

        let fullResponse = '';
        let fullReasoning = '';
        let reasoningStarted = false;
        let reasoningFinalized = false;
        let explanationComplete = false;
        let explanationContent = '';
        let resultContent = '';

        const userAfterId =
            userMessageEl?.getAttribute('data-msg-id') ||
            userMessageEl?._msgId ||
            null;

        const explanationMessageId = this.ctx.generateMessageId();
        let resultMessageId: string | null = null;
        let explanationMessageReady = false;

        const ensureExplanationMessage = () => {
            if (explanationMessageReady) return;
            const reasoningEl = this.ctx.findReasoningBlockElement(lockedMode, turnId);
            let afterId = userAfterId || undefined;
            if (reasoningEl) {
                let reasoningId = reasoningEl.getAttribute('data-msg-id') || reasoningEl._msgId;
                if (!reasoningId) {
                    reasoningId = this.ctx.generateMessageId();
                    reasoningEl.setAttribute('data-msg-id', reasoningId);
                    reasoningEl._msgId = reasoningId;
                }
                afterId = reasoningId;
            }

            eventBus.emit('render:addStreamingMessage', {
                mode: lockedMode,
                messageId: explanationMessageId,
                isResult: false,
                afterId,
                turnId
            });
            explanationMessageReady = true;
        };

        // Throttled render: accumulate content, emit at most once per 30ms
        let pendingRender: { messageId: string; content: string } | null = null;
        let renderTimer: number | null = null;
        let renderCanceled = false;
        const flushRender = () => {
            renderTimer = null;
            if (!pendingRender) return;
            if (renderCanceled || abortController.signal.aborted) {
                pendingRender = null;
                return;
            }
            eventBus.emit('render:updateStreamingMessage', {
                mode: lockedMode,
                messageId: pendingRender.messageId,
                content: pendingRender.content
            });
            pendingRender = null;
        };
        const scheduleRender = (messageId: string, content: string) => {
            if (renderCanceled || abortController.signal.aborted) return;
            pendingRender = { messageId, content };
            if (renderTimer !== null) return;
            renderTimer = window.setTimeout(flushRender, 30);
        };

        const cancelPendingRender = () => {
            renderCanceled = true;
            pendingRender = null;
            if (renderTimer !== null) {
                window.clearTimeout(renderTimer);
                renderTimer = null;
            }
        };
        const abortListener = () => {
            cancelPendingRender();
        };
        abortController.signal.addEventListener('abort', abortListener, { once: true });

        try {
            await this.streamingHandler.stream({
                tab: lockedMode,
                client: this.ctx.plugin.ollamaClient,
                messages,
                signal: abortController.signal,
                onChunk: (chunk) => {
                    // DEBUG: Log all chunk types to see if metrics arrive
                    if (chunk.type !== 'content' && chunk.type !== 'thinking') {
                        console.debug('[EditDiscussHandler] Chunk type:', chunk.type, chunk);
                    }

                    // Update token count and metrics
                    if (chunk.type === 'content' || chunk.type === 'thinking') {
                        const tokenCount = this.ctx.getGenerationTokenCount();
                        this.ctx.setGenerationTokenCount(tokenCount + Math.ceil(chunk.text.split(/\s+/).length / 1.3));
                    }

                    // Get speed from metrics if available
                    if (chunk.type === 'metrics' && chunk.metrics) {
                        this.ctx.setCurrentGenerationSpeed(chunk.metrics.speed);
                        Actions.updateGenerationSpeed(this.ctx.store, chunk.metrics.speed);

                        Actions.setTokenMetrics(
                            this.ctx.store,
                            lockedMode,
                            chunk.metrics.prompt_eval_count,
                            chunk.metrics.eval_count
                        );

                        // Emit token metrics event with real data from Ollama
                        this.ctx.eventBus.emit('tokens:counted', {
                            tab: lockedMode,
                            promptTokens: chunk.metrics.prompt_eval_count,
                            responseTokens: chunk.metrics.eval_count,
                            speed: chunk.metrics.speed
                        });
                    }

                    if (chunk.type === 'thinking') {
                        if (reasoningFinalized) {
                            return;
                        }
                        reasoningStarted = true;
                        fullReasoning += chunk.text;
                        eventBus.emit('render:updateReasoningBlock', {
                            mode: lockedMode,
                            turnId: turnId,
                            content: fullReasoning
                        });
                    } else if (chunk.type !== 'metrics') {
                        if (chunk.type === 'content' && reasoningStarted && !reasoningFinalized) {
                            eventBus.emit('render:finalizeReasoningBlock', { mode: lockedMode, turnId });
                            reasoningFinalized = true;
                        }
                        fullResponse += chunk.text;

                        // Only process EDIT markers in Edit mode
                        if (isEditMode && fullResponse.includes('<EDIT>') && !explanationComplete) {
                            ensureExplanationMessage();
                            const parts = fullResponse.split('<EDIT>');
                            explanationContent = parts[0].trim();

                            eventBus.emit('render:finalizeExplanationMessage', {
                                messageId: explanationMessageId,
                                mode: lockedMode,
                                content: explanationContent,
                                turnId: turnId
                            });

                            // Capture rendered HTML/classes + reasoning (without handlers touching DOM)
                            const reasoningUi = this.ctx.getReasoningUiDataForMessage(explanationMessageId, lockedMode);
                            this.ctx.captureMessageRendered(explanationMessageId, lockedMode, {
                                reasoningHtml: reasoningUi?.reasoningHtml,
                                reasoningCollapsed: reasoningUi?.reasoningCollapsed
                            });

                            explanationComplete = true;
                            resultMessageId = this.ctx.generateMessageId();

                            // Create streaming message for result (MessageRenderer listens to render:addStreamingMessage)
                            eventBus.emit('render:addStreamingMessage', {
                                mode: lockedMode,
                                messageId: resultMessageId,
                                isResult: true,
                                afterId: explanationMessageId,
                                editNumber: this.ctx.getCurrentEditNumber(),
                                turnId
                            });

                            // If we already have some result content after <EDIT>, start streaming it immediately
                            if (parts[1]) {
                                resultContent = MarkdownUtils.cleanResultMarkers(parts[1]);
                                scheduleRender(resultMessageId, resultContent);
                            }
                        } else if (explanationComplete && resultMessageId) {
                            const parts = fullResponse.split('<EDIT>')[1];
                            if (parts) {
                                resultContent = MarkdownUtils.cleanResultMarkers(parts);
                                scheduleRender(resultMessageId, resultContent);
                            }
                        } else {
                            ensureExplanationMessage();
                            scheduleRender(explanationMessageId, fullResponse);
                        }
                    }
                }
            });
        } finally {
            abortController.signal.removeEventListener('abort', abortListener);
            // Flush pending throttled render only for active (non-aborted) stream.
            if (renderCanceled || abortController.signal.aborted) {
                cancelPendingRender();
            } else if (renderTimer !== null) {
                window.clearTimeout(renderTimer);
                flushRender();
            }
        }

        // Finalize reasoning block if it was streamed but not finalized
        if (reasoningStarted && !reasoningFinalized) {
            eventBus.emit('render:finalizeReasoningBlock', { mode: lockedMode, turnId: turnId });
            reasoningFinalized = true;
        }

        // Finalize messages
        if (!explanationComplete) {
            if (fullResponse.trim()) {
                ensureExplanationMessage();
            }
            eventBus.emit('render:finalizeStreamingMessage', {
                messageId: explanationMessageId,
                content: fullResponse,
                mode: lockedMode,
                turnId: turnId
            });

            // Capture rendered HTML/classes + reasoning
            const reasoningUi = this.ctx.getReasoningUiDataForMessage(explanationMessageId, lockedMode);
            this.ctx.captureMessageRendered(explanationMessageId, lockedMode, {
                reasoningHtml: reasoningUi?.reasoningHtml,
                reasoningCollapsed: reasoningUi?.reasoningCollapsed
            });
        } else if (resultMessageId) {
            const parts = fullResponse.split('<EDIT>')[1];
            if (parts) {
                resultContent = MarkdownUtils.cleanResultMarkers(parts);
            }
            eventBus.emit('render:finalizeResultMessage', {
                messageId: resultMessageId,
                resultContent,
                rawContent: fullResponse,
                mode: lockedMode,
                editNumber: this.ctx.getCurrentEditNumber(),
                turnId: turnId
            });

            // Capture rendered HTML/classes + reasoning and result data
            const resultReasoningUi = this.ctx.getReasoningUiDataForMessage(resultMessageId, lockedMode);
            this.ctx.captureMessageRendered(resultMessageId, lockedMode, {
                editNumber: this.ctx.getCurrentEditNumber(),
                resultContent,
                reasoningHtml: resultReasoningUi?.reasoningHtml,
                reasoningCollapsed: resultReasoningUi?.reasoningCollapsed
            });
        }

        // Sync history with Store
        this.ctx.eventBus.emit('generation:completed', { tab: lockedMode });
    }
}
