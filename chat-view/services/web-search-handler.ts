import type OllamaAssistantPlugin from '../../main';
import type { OllamaMessage, OllamaTool } from '../../ollama-client';
import type { TabState } from '../types';
import { MarkdownUtils } from '../markdown-utils';
import type { RequestProcessorContext } from './request-context';
import { StreamingHandler } from './streaming-handler';
import { ToolCallHandler } from './tool-call-handler';
import { Actions } from '../core/actions';
import { updateSystemMessageContent } from '../utils/turn-builder';

/**
 * WebSearchHandler - handles agent logic for web_search/fetch_page tools
 */
export class WebSearchHandler {
    private toolCallHandler: ToolCallHandler;

    constructor(
        private ctx: RequestProcessorContext,
        private streamingHandler: StreamingHandler
    ) {
        this.toolCallHandler = new ToolCallHandler(ctx);
    }

    private getMessageElById(id: string): HTMLElement | null {
        return this.ctx.findChatMessageElementById(id);
    }

    async processWeb(
        messages: OllamaMessage[],
        lockedMode: 'edit' | 'discuss' | 'web',
        lockedTabState: TabState,
        userMessageEl: HTMLElement | null | undefined,
        abortController: AbortController
    ): Promise<void> {
        const eventBus = this.ctx.eventBus;

        // IMPORTANT: Lock userMessageEl to prevent it being overwritten by queued requests
        const webUserMessageEl = userMessageEl;
        const webUserMessageId = webUserMessageEl?.getAttribute('data-msg-id') || undefined;
        const turnId = webUserMessageId || this.ctx.generateMessageId();

        const maxAgentSteps = 5;

        // SHARED state across all agent steps (via closure)
        let agentStatusId: string | null = null;
        // FIXED: Track the last inserted element ID to maintain order
        // Order: user -> reasoning (optional) -> system messages -> assistant
        let lastInsertedId: string | undefined = webUserMessageId;
        let reasoningId: string | null = null;
        let reasoningStarted = false;
        let reasoningFinalized = false;
        let fullReasoning = '';

        const findById = (id?: string | null): HTMLElement | null => {
            if (!id) return null;
            return this.getMessageElById(id);
        };

        const getMessageContentEl = (id?: string | null): HTMLElement | null => {
            const el = findById(id);
            return (el?.querySelector('.message-content') as HTMLElement | null) || null;
        };

        const updateSystemTurnMessage = (messageId: string | null, content: string): void => {
            if (!turnId || !messageId) return;
            const turn = lockedTabState.turns.find(t => t.id === turnId);
            if (turn) {
                updateSystemMessageContent(turn, messageId, content);
            }
        };


        // Define tools for Ollama
        const tools: OllamaTool[] = [
            {
                type: 'function',
                function: {
                    name: 'web_search',
                    description: 'Search the internet for information. Returns list of relevant web pages.',
                    parameters: {
                        type: 'object',
                        required: ['query'],
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Search query to find information on the internet'
                            }
                        }
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'fetch_page',
                    description: 'Fetch and read content from a specific web page URL.',
                    parameters: {
                        type: 'object',
                        required: ['url'],
                        properties: {
                            url: {
                                type: 'string',
                                description: 'URL of the web page to read'
                            }
                        }
                    }
                }
            }
        ];

        // FIXED: Get insert anchor based on tracked lastInsertedId
        // This ensures messages are inserted in correct order: user -> reasoning -> system -> assistant
        const getInsertAfterId = (): string | undefined => {
            if (!lastInsertedId) return webUserMessageId;
            const candidate = findById(lastInsertedId);
            if (candidate && candidate.parentNode) {
                return lastInsertedId;
            }
            // Fallback: find last element in this turn
            if (!webUserMessageEl || !webUserMessageEl.parentNode) {
                return webUserMessageId;
            }
            let lastEl: HTMLElement = webUserMessageEl;
            let nextEl = webUserMessageEl.nextElementSibling as HTMLElement | null;
            while (nextEl) {
                const nextTurnId = nextEl.getAttribute('data-turn-id');
                const isActiveUserMessage = nextEl.classList.contains('user-message') &&
                                           !nextEl.querySelector('.queued-status');
                // Stop if different turn or active user message
                if ((nextTurnId && nextTurnId !== turnId) || 
                    (isActiveUserMessage && nextEl.getAttribute('data-msg-id') !== webUserMessageId) ||
                    nextEl.getAttribute('data-mode') !== lockedMode) {
                    break;
                }
                lastEl = nextEl;
                nextEl = nextEl.nextElementSibling as HTMLElement | null;
            }
            lastInsertedId = lastEl.getAttribute('data-msg-id') || webUserMessageId;
            return lastInsertedId;
        };

        // Agent loop - recursive function
        const runAgentStep = async (currentMessages: OllamaMessage[], step: number): Promise<void> => {
            if (step > maxAgentSteps) {
                const errorMsgId = this.ctx.generateMessageId();
                const errorAfterId = getInsertAfterId();
                eventBus.emit('render:addSystemMessage', {
                    content: '! Agent step limit exceeded',
                    isStopMessage: false,
                    mode: lockedMode,
                    isError: true,
                    afterId: errorAfterId,
                    messageId: errorMsgId,
                    turnId
                });
                lastInsertedId = errorMsgId;

                return;
            }

            // CRITICAL: These variables are local to EACH step
            // NOTE: Use a ref object so TypeScript doesn't assume it stays null
            // (assignments happen inside the `onChunk` callback).
            const toolCallRef: { current: { name: string; arguments: unknown } | null } = { current: null };
            let finalAnswer = '';
            let hadToolCall = false; // Reset on each new step
            let streamingMessageId: string | null = null;
            let contentChunkCount = 0; // Content chunk counter

            // Throttled render: emit at most once per 50ms
            let pendingWebRender: { messageId: string; content: string } | null = null;
            let webRenderTimer: number | null = null;
            let webRenderCanceled = false;
            const flushWebRender = () => {
                webRenderTimer = null;
                if (!pendingWebRender) return;
                if (webRenderCanceled || abortController.signal.aborted) {
                    pendingWebRender = null;
                    return;
                }
                eventBus.emit('render:updateStreamingMessage', {
                    mode: lockedMode,
                    messageId: pendingWebRender.messageId,
                    content: pendingWebRender.content
                });
                pendingWebRender = null;
            };
            const scheduleWebRender = (messageId: string, content: string) => {
                if (webRenderCanceled || abortController.signal.aborted) return;
                pendingWebRender = { messageId, content };
                if (webRenderTimer !== null) return;
                webRenderTimer = window.setTimeout(flushWebRender, 30);
            };
            const cancelPendingWebRender = () => {
                webRenderCanceled = true;
                pendingWebRender = null;
                if (webRenderTimer !== null) {
                    window.clearTimeout(webRenderTimer);
                    webRenderTimer = null;
                }
            };
            const abortListener = () => {
                cancelPendingWebRender();
            };
            abortController.signal.addEventListener('abort', abortListener, { once: true });

            try {
                await this.streamingHandler.stream({
                    tab: lockedMode,
                    client: this.ctx.plugin.ollamaClient,
                    messages: currentMessages,
                    signal: abortController.signal,
                    tools,
                    onChunk: (chunk) => {
                    // Update token count for speed calculation
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
                        console.debug(`[Web Step ${step}] Metrics:`, 'prompt:', chunk.metrics.prompt_eval_count, 'response:', chunk.metrics.eval_count);
                        this.ctx.eventBus.emit('tokens:counted', {
                            tab: lockedMode,
                            promptTokens: chunk.metrics.prompt_eval_count,
                            responseTokens: chunk.metrics.eval_count,
                            speed: chunk.metrics.speed
                        });
                    }

                    if (chunk.type === 'thinking') {
                        fullReasoning += chunk.text;
                        if (fullReasoning.trim().length > 0 && webUserMessageId) {
                            if (reasoningFinalized) {
                                reasoningFinalized = false;
                            }
                            if (!reasoningStarted) {
                                reasoningStarted = true;
                                reasoningId = this.ctx.generateMessageId();
                                // Reasoning goes right after user message
                                eventBus.emit('render:addReasoningBlock', {
                                    mode: lockedMode,
                                    turnId,
                                    afterId: webUserMessageId,
                                    reasoningId,
                                    appendToEnd: false
                                });
                                // Update lastInsertedId to reasoning block
                                lastInsertedId = reasoningId;
                            }
                            eventBus.emit('render:updateReasoningBlock', { mode: lockedMode, turnId, content: fullReasoning });
                        }
                        return;
                    }

                    if (chunk.type === 'tool_call' && chunk.tool) {
                        if (reasoningStarted && !reasoningFinalized) {
                            eventBus.emit('render:finalizeReasoningBlock', { mode: lockedMode, turnId });
                            reasoningFinalized = true;
                        }
                        hadToolCall = true;
                        toolCallRef.current = {
                            name: chunk.tool.name,
                            arguments: chunk.tool.arguments
                        };
                        console.debug(`[Agent Step ${step}] Tool call via FC:`, toolCallRef.current);

                        // KEY: simply reset buffer and remove streaming message if exists
                        // This ensures we only show text AFTER the last tool call
                        if (streamingMessageId) {
                            const el = findById(streamingMessageId);
                            el?.remove();
                            streamingMessageId = null;
                        }
                        finalAnswer = '';
                        return;
                    }

                    if (chunk.type === 'content') {
                        if (reasoningStarted && !reasoningFinalized) {
                            eventBus.emit('render:finalizeReasoningBlock', { mode: lockedMode, turnId });
                            reasoningFinalized = true;
                        }
                        // If tool call happened on this step - don't expect more content
                        if (hadToolCall) {
                            return;
                        }

                        // Accumulate text
                        finalAnswer += chunk.text;
                        contentChunkCount++;

                        // Show streaming ONLY after 3+ chunks AND only on step > 1
                        // This ensures the model is actually writing a response, not preparing to call a tool
                        if (step > 1 && contentChunkCount >= 3 && finalAnswer.trim().length > 0) {
                            if (!streamingMessageId) {
                                // Finalize system message before starting streaming
                                const contentEl = getMessageContentEl(agentStatusId);
                                if (contentEl) {
                                    // eslint-disable-next-line obsidianmd/ui/sentence-case -- symbol prefix
                                    contentEl.textContent = '✓ Information found';
                                    updateSystemTurnMessage(agentStatusId, contentEl.textContent);
                                }

                                streamingMessageId = this.ctx.generateMessageId();
                                const streamAfterId = getInsertAfterId();
                                eventBus.emit('render:addStreamingMessage', {
                                    mode: lockedMode,
                                    messageId: streamingMessageId,
                                    isResult: false,
                                    afterId: streamAfterId,
                                    turnId
                                });
                                lastInsertedId = streamingMessageId;
                            }
                            scheduleWebRender(streamingMessageId, finalAnswer);
                        }
                    }
                    }
                });
            } finally {
                abortController.signal.removeEventListener('abort', abortListener);
                // Flush pending throttled render only for active (non-aborted) stream.
                if (webRenderCanceled || abortController.signal.aborted) {
                    cancelPendingWebRender();
                } else if (webRenderTimer !== null) {
                    window.clearTimeout(webRenderTimer);
                    flushWebRender();
                }
            }

            // Handle tool call via Function Calling
            const toolCallDetected = toolCallRef.current;
            if (!toolCallDetected && !finalAnswer.trim()) {
                if (reasoningStarted && !reasoningFinalized) {
                    eventBus.emit('render:finalizeReasoningBlock', { mode: lockedMode, turnId });
                    reasoningFinalized = true;
                }
                const errorMsgId = this.ctx.generateMessageId();
                const errorAfterId = getInsertAfterId();
                eventBus.emit('render:addSystemMessage', {
                    content: 'Error: No response received',
                    isStopMessage: false,
                    mode: lockedMode,
                    isError: true,
                    afterId: errorAfterId,
                    messageId: errorMsgId,
                    turnId
                });
                lastInsertedId = errorMsgId;
                return;
            }

            if (toolCallDetected) {
                const toolCall = toolCallDetected;

                // Create status message if missing
                if (!agentStatusId) {
                    const initialText = toolCall.name === 'fetch_page'
                        ? '→ Reading page...'
                        : '→ Searching for information...';

                    agentStatusId = this.ctx.generateMessageId();
                    const systemAfterId = getInsertAfterId();
                    eventBus.emit('render:addSystemMessage', {
                        content: initialText,
                        isStopMessage: false,
                        mode: lockedMode,
                        isError: false,
                        afterId: systemAfterId,
                        messageId: agentStatusId,
                        turnId
                    });
                    lastInsertedId = agentStatusId;
                }

                // Pre-call status adjustments
                const statusContentEl = getMessageContentEl(agentStatusId);
                if (toolCall.name === 'web_search' && statusContentEl) {
                    const args = toolCall.arguments as Record<string, unknown> | null;
                    const query = args && typeof args.query === 'string' ? args.query : '';
                    statusContentEl.textContent = `→ Search: "${query}"`;
                    updateSystemTurnMessage(agentStatusId, statusContentEl.textContent || '');
                }
                if (toolCall.name === 'fetch_page' && statusContentEl) {
                    // eslint-disable-next-line obsidianmd/ui/sentence-case -- symbol prefix
                    statusContentEl.textContent = '→ Reading page...';
                    updateSystemTurnMessage(agentStatusId, statusContentEl.textContent || '');
                }

                // Execute tool call via handler
                const result = await this.toolCallHandler.executeToolCall(toolCall);

                // Update status with post-call text
                if (statusContentEl && result.statusText) {
                    statusContentEl.textContent = result.statusText;
                    updateSystemTurnMessage(agentStatusId, statusContentEl.textContent || '');
                }
                
                // Push tool + system messages returned by handler
                if (result.toolMessages?.length) {
                    currentMessages.push(...result.toolMessages);
                }
                if (result.systemMessages?.length) {
                    currentMessages.push(...result.systemMessages);
                }

                await runAgentStep(currentMessages, step + 1);

            } else if (finalAnswer.trim()) {
                if (step === 1) {
                    // First step without tool call - fallback to manual search
                    // (text written by model is NOT shown - it's ignored)
                    if (!agentStatusId) {
                        agentStatusId = this.ctx.generateMessageId();
                        const fallbackAfterId = getInsertAfterId();
                        eventBus.emit('render:addSystemMessage', {
                            content: '→ Searching for information...',
                            isStopMessage: false,
                            mode: lockedMode,
                            isError: false,
                            afterId: fallbackAfterId,
                            messageId: agentStatusId,
                            turnId
                        });
                        lastInsertedId = agentStatusId;
                    }

                    const originalMessage = currentMessages[currentMessages.length - 1]?.content || '';
                    const result = await this.toolCallHandler.executeToolCall({
                        name: 'web_search',
                        arguments: { query: originalMessage }
                    });

                    const contentEl = getMessageContentEl(agentStatusId);
                    if (contentEl && result.statusText) {
                        contentEl.textContent = result.statusText;
                        updateSystemTurnMessage(agentStatusId, contentEl.textContent || '');
                    }

                    if (result.toolMessages?.length) {
                        currentMessages.push(...result.toolMessages);
                    }
                    // In fallback don't add systemMessages to keep previous behavior

                    await runAgentStep(currentMessages, step + 1);
                } else if (finalAnswer.length > 0) {
                    // Final answer after tools were used
                    this.ctx.clearStreamingThrottle();

                    // If streaming message was not created (e.g., empty text during streaming)
                    if (!streamingMessageId) {
                        const contentEl = getMessageContentEl(agentStatusId);
                        if (contentEl) {
                            // eslint-disable-next-line obsidianmd/ui/sentence-case -- symbol prefix
                            contentEl.textContent = '✓ Information found';
                            updateSystemTurnMessage(agentStatusId, contentEl.textContent);
                        }

                        streamingMessageId = this.ctx.generateMessageId();
                        const finalAfterId = getInsertAfterId();
                        eventBus.emit('render:addStreamingMessage', {
                            mode: lockedMode,
                            messageId: streamingMessageId,
                            isResult: false,
                            afterId: finalAfterId,
                            turnId
                        });
                        lastInsertedId = streamingMessageId;
                    }

                    // IMPORTANT: finalize reasoning BEFORE finalizing the assistant message,
                    // otherwise reasoningHtml won't be attached to the assistant message in history.
                    if (reasoningStarted && !reasoningFinalized) {
                        eventBus.emit('render:finalizeReasoningBlock', { mode: lockedMode, turnId });
                        reasoningFinalized = true;
                    }

                    eventBus.emit('render:finalizeStreamingMessage', {
                        messageId: streamingMessageId,
                        content: finalAnswer,
                        mode: lockedMode,
                        turnId
                    });
                }
            }
        };

        await runAgentStep(messages, 1);

        // Best-effort: if we streamed reasoning but never finalized it before a finalize message,
        // finalize now so it doesn't keep a cursor.
        if (reasoningStarted && !reasoningFinalized) {
            eventBus.emit('render:finalizeReasoningBlock', { mode: lockedMode, turnId });
            reasoningFinalized = true;
        }
    }
}
