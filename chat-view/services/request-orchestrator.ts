import { MarkdownView, Notice } from 'obsidian';
import type { OllamaMessage, StreamChunk } from '../../ollama-client';
import type { QueuedRequest, TabState } from '../types';
import { MarkdownUtils } from '../markdown-utils';
import { PromptBuilder } from './prompt-builder';
import { StreamingHandler } from './streaming-handler';
import { WebSearchHandler } from './web-search-handler';
import { EditDiscussHandler } from './edit-discuss-handler';
import { RequestService } from './request-service';
import { Actions } from '../core/actions';
import type { RequestProcessorContext } from './request-context';
import type { EventBus } from '../core/event-bus';
import { createTurn, addReasoningToTurn, addAssistantToTurn, addResultToTurn } from '../utils/turn-builder';
import { extractTextFromReasoningHtml } from '../utils/reasoning-utils';

/**
 * RequestOrchestrator - request processing coordinator.
 * Handles the full request lifecycle including routing to appropriate handlers.
 */
export class RequestOrchestrator {
    private ctx: RequestProcessorContext;
    private promptBuilder: PromptBuilder;
    private streamingHandler: StreamingHandler;
    private webSearchHandler: WebSearchHandler;
    private editDiscussHandler: EditDiscussHandler;
    private requestService: RequestService;
    private currentTurnId: string | undefined; // Track current turn ID for error handling

    constructor(context: RequestProcessorContext, eventBus?: EventBus) {
        this.ctx = context;
        this.promptBuilder = new PromptBuilder();
        this.streamingHandler = new StreamingHandler(eventBus ?? context.eventBus);
        this.webSearchHandler = new WebSearchHandler(context, this.streamingHandler);
        this.editDiscussHandler = new EditDiscussHandler(context, this.streamingHandler);
        this.requestService = new RequestService(context, this.processMessage.bind(this));
    }

    private parseSourceEditFromLabel(label?: string): number | undefined {
        if (!label) return undefined;
        const match = label.match(/^Edit\s+(\d+)\b/i);
        if (!match) return undefined;
        const num = parseInt(match[1], 10);
        if (isNaN(num) || num <= 0) return undefined;
        return num;
    }

    private inferSourceEditNumber(
        contextLabel: string | undefined,
        contextText: string,
        tabState: TabState
    ): number | undefined {
        const byLabel = this.parseSourceEditFromLabel(contextLabel);
        if (byLabel !== undefined) return byLabel;

        const normalize = (text: string): string => text.replace(/\r\n/g, '\n');
        const normalizedContext = normalize(contextText || '');
        const normalizedContextTrimmed = normalizedContext.trim();
        if (!normalizedContext) return undefined;

        for (let i = tabState.turns.length - 1; i >= 0; i--) {
            const turn = tabState.turns[i];
            const result = turn.result;
            if (!result?.editNumber) continue;
            const resultContent = normalize(result.content || '');
            if (resultContent === normalizedContext || resultContent.trim() === normalizedContextTrimmed) {
                return result.editNumber;
            }
        }

        return undefined;
    }

    private findBestOccurrence(haystack: string, needle: string, preferredIndex: number): number | null {
        if (!needle) return null;
        const occurrences: number[] = [];
        let idx = haystack.indexOf(needle);
        while (idx !== -1) {
            occurrences.push(idx);
            idx = haystack.indexOf(needle, idx + 1);
        }
        if (occurrences.length === 0) return null;
        if (occurrences.length === 1) return occurrences[0];

        let best = occurrences[0];
        let bestDist = Math.abs(best - preferredIndex);
        for (const o of occurrences) {
            const dist = Math.abs(o - preferredIndex);
            if (dist < bestDist) {
                best = o;
                bestDist = dist;
            }
        }
        return best;
    }

    private syncTurnsToStore(tab: 'edit' | 'discuss' | 'web'): void {
        const tabState = this.ctx.getTabState(tab);
        Actions.setTurns(this.ctx.store, tab, tabState.turns);
    }

    /**
     * Send message (entry point)
     */
    async sendMessage(message: string, textarea: HTMLTextAreaElement | null) {
        await this.requestService.sendMessage(message, textarea);
    }

    /**
     * Main message processing method
     * @param fromQueue - true if request from queue (context already cleared)
     * @param savedContext - saved context from queue (used instead of tabState)
     */
    async processMessage(
        message: string,
        textarea: HTMLTextAreaElement | null,
        mode: 'edit' | 'discuss' | 'web',
        fromQueue: boolean = false,
        userMessageEl?: HTMLElement | null,
        savedContext?: { selectedText: string; selectedTextStart: number; selectedTextEnd: number; contextLabel?: string }
    ) {
        // LOCK the mode for this specific generation
        const lockedMode = mode;
        this.ctx.setProcessingTab(lockedMode);

        // Get locked tab state
        const lockedTabState = this.ctx.getTabState(lockedMode);

        // Set processing state (only if not already set from sendMessage)
        // For queued requests, this ensures the flag is set after previous request cleared it
        if (!this.ctx.isProcessing) {
            this.ctx.setProcessing(true);
            this.ctx.updateSendButtonState(true);
            Actions.startProcessing(this.ctx.store, lockedMode);
        }

        // Update tab indicators to show processing
        this.ctx.updateTabIndicators();

        // Mark tab as calculating
        this.ctx.getTabStates()[lockedMode].isCalculating = true;
        Actions.setCalculating(this.ctx.store, lockedMode, true);

        if (textarea) {
            textarea.value = '';
        }

        // Clear saved textarea content for locked mode
        lockedTabState.textareaContent = '';
        Actions.clearTextareaContent(this.ctx.store, lockedMode);

        // Declare message elements before try block so they're accessible in catch
        const explanationMessageEl: HTMLElement | null = null;
        const resultMessageEl: HTMLElement | null = null;
        const isEditMode = lockedMode === 'edit';
        const isWebMode = lockedMode === 'web';

        try {
            // Get the active file and find its markdown view
            // NOTE: Must be inside try block so finalizeProcessing() is called on failure
            const activeFile = this.ctx.app.workspace.getActiveFile();
            let markdownView: MarkdownView | null = null;

            if (activeFile) {
                const leaves = this.ctx.app.workspace.getLeavesOfType('markdown');
                for (const leaf of leaves) {
                    const view = leaf.view as MarkdownView;
                    if (view && view.file === activeFile && view.editor) {
                        markdownView = view;
                        break;
                    }
                }
            }

            if (!markdownView || !markdownView.editor) {
                new Notice('Please open a note first');
                return;
            }

            const noteContent = markdownView.editor.getValue();
            // Edit mode specific: increment counter and save position
            if (isEditMode) {
                // IMPORTANT: queued requests must use savedContext, because tabState context
                // is intentionally cleared when the request is queued.
                const effectiveSelectedText = (fromQueue && savedContext)
                    ? (savedContext.selectedText || '')
                    : (lockedTabState.selectedText || '');
                const effectiveSelectedTextStart = (fromQueue && savedContext)
                    ? (savedContext.selectedTextStart || 0)
                    : lockedTabState.selectedTextStart;
                const effectiveSelectedTextEnd = (fromQueue && savedContext)
                    ? (savedContext.selectedTextEnd || 0)
                    : lockedTabState.selectedTextEnd;

                // Increment edit counter for new edit
                const newEditCounter = this.ctx.getEditCounter() + 1;
                this.ctx.setEditCounter(newEditCounter);
                this.ctx.setCurrentEditNumber(newEditCounter);

                // Save position for this specific edit
                if (effectiveSelectedText) {
                    let start = effectiveSelectedTextStart;
                    let end = effectiveSelectedTextEnd;

                    // If offsets are invalid or don't match, try to locate selectedText in the note.
                    const offsetsLookValid = start !== end;
                    const sliceMatches = offsetsLookValid
                        ? noteContent.substring(start, end) === effectiveSelectedText
                        : false;

                    if (!sliceMatches) {
                        const preferred = offsetsLookValid ? start : 0;
                        const foundAt = this.findBestOccurrence(noteContent, effectiveSelectedText, preferred);
                        if (foundAt !== null) {
                            start = foundAt;
                            end = foundAt + effectiveSelectedText.length;
                        }
                    }

                    // If we still can't establish a valid range, store a non-whole-note edit.
                    // This prevents Apply from overwriting the entire note; it will fall back to
                    // search/manual insertion in NoteService.
                    if (start === end) {
                        console.debug(`[RequestOrchestrator] Saving Edit ${this.ctx.getCurrentEditNumber()} position (not found in doc):`, {
                            text: effectiveSelectedText.substring(0, 50) + '...',
                            start: 0,
                            end: 0
                        });
                        this.ctx.setEditPosition(this.ctx.getCurrentEditNumber(), {
                            text: effectiveSelectedText,
                            start: 0,
                            end: 0,
                            isWholeNote: false
                        });
                    } else {
                        // IMPORTANT: Save effectiveSelectedText (context text), NOT noteContent!
                        // When "Add to context" is used on an Edit, effectiveSelectedText contains
                        // the AI's result (e.g., with emojis), but the note may still have the old text.
                        // We must save what was used as context so Apply can find it after restart.

                        // Save anchors (context around the edit) - 3 lines before and after
                        const linesBefore = noteContent.substring(0, start).split('\n');
                        const linesAfter = noteContent.substring(end).split('\n');
                        const anchorBefore = linesBefore.slice(-3).join('\n');
                        const anchorAfter = linesAfter.slice(0, 3).join('\n');

                        console.debug(`[RequestOrchestrator] Saving Edit ${this.ctx.getCurrentEditNumber()} position:`, {
                            text: effectiveSelectedText.substring(0, 50) + '...',
                            start,
                            end
                        });
                        this.ctx.setEditPosition(this.ctx.getCurrentEditNumber(), {
                            text: effectiveSelectedText,
                            start,
                            end,
                            isWholeNote: false,
                            anchorBefore,
                            anchorAfter
                        });
                    }
                } else {
                    // Defensive: if we somehow have no context in edit mode, do NOT treat it
                    // as whole-note; let NoteService fall back to search/manual placement.
                    this.ctx.setEditPosition(this.ctx.getCurrentEditNumber(), {
                        text: '',
                        start: 0,
                        end: 0,
                        isWholeNote: false
                    });
                }

                // Link edit chain if context came from another edit.
                // Fallback: infer by exact result-content match when label is unavailable.
                const effectiveContextLabel = (fromQueue && savedContext)
                    ? savedContext.contextLabel
                    : lockedTabState.contextLabel;

                const sourceEditNumber = this.inferSourceEditNumber(
                    effectiveContextLabel,
                    effectiveSelectedText,
                    lockedTabState
                );

                if (
                    sourceEditNumber !== undefined &&
                    sourceEditNumber > 0 &&
                    sourceEditNumber !== this.ctx.getCurrentEditNumber()
                ) {
                    Actions.linkEditChain(this.ctx.store, this.ctx.getCurrentEditNumber(), sourceEditNumber);
                    console.debug(
                        `[RequestOrchestrator] Linked Edit ${this.ctx.getCurrentEditNumber()} to Edit ${sourceEditNumber}`
                    );
                }
            }

            // Generate ID for user message first
            const userMsgId = this.ctx.generateMessageId();
            const eventBus = this.ctx.eventBus;

            // Add user message to UI (unless from queue - already added)
            if (!fromQueue) {
                const contextForMsg = savedContext?.selectedText || lockedTabState.selectedText || '';
                const contextLabelForMsg = savedContext?.contextLabel || lockedTabState.contextLabel;
                eventBus.emit('render:addUserMessage', {
                    content: message,
                    mode: lockedMode,
                    msgId: userMsgId,
                    contextContent: contextForMsg,
                    contextLabel: contextLabelForMsg,
                    turnId: userMsgId
                });
                this.ctx.scrollToBottom();
                userMessageEl = this.ctx.findChatMessageElementById(userMsgId);
            } else if (userMessageEl) {
                // Ensure queued message has an ID so streaming can attach correctly
                const existingId = userMessageEl.getAttribute('data-msg-id');
                if (!existingId || existingId !== userMsgId) {
                    userMessageEl.setAttribute('data-msg-id', userMsgId);
                    userMessageEl._msgId = userMsgId;
                }
                userMessageEl.setAttribute('data-turn-id', userMsgId);
            }

            const contextToCapture = savedContext || {
                selectedText: lockedTabState.selectedText,
                selectedTextStart: lockedTabState.selectedTextStart,
                selectedTextEnd: lockedTabState.selectedTextEnd,
                contextLabel: lockedTabState.contextLabel
            };

            // Clear reasoning block for new generation
            // NOTE: Store reasoning block for THIS specific generation (lockedMode)
            const reasoningBlockEl: HTMLElement | null = null;
            const fullReasoning = '';

            // Create abort controller for stopping generation
            const abortController = new AbortController();
            this.ctx.setCurrentAbortController(abortController);
            Actions.setAbortController(this.ctx.store, abortController);

            // Initialize generation tracking
            this.ctx.setGenerationTokenCount(0);

            // === NEW: Use PromptBuilder BEFORE clearing context! ===
            // Use savedContext if from queue, otherwise use current tabState
            const contextToUse = fromQueue && savedContext ? savedContext : {
                selectedText: lockedTabState.selectedText,
                selectedTextStart: lockedTabState.selectedTextStart,
                selectedTextEnd: lockedTabState.selectedTextEnd,
                contextLabel: lockedTabState.contextLabel
            };

            let messages: OllamaMessage[];
            let contextNote: string;

            if (isWebMode) {
                const result = this.promptBuilder.buildWebPrompt({
                    message,
                    maxHistoryMessages: this.ctx.plugin.settings.maxHistoryMessages
                });
                messages = result.messages;
                contextNote = result.contextNote;
            } else if (isEditMode) {
                const result = this.promptBuilder.buildEditPrompt({
                    message,
                    selectedText: contextToUse.selectedText, // Use saved context for queued requests
                    maxHistoryMessages: this.ctx.plugin.settings.maxHistoryMessages
                });
                messages = result.messages;
                contextNote = result.contextNote;
            } else {
                // Discuss mode
                const result = this.promptBuilder.buildDiscussPrompt({
                    message,
                    selectedText: contextToUse.selectedText, // Use saved context for queued requests
                    turns: lockedTabState.turns,
                    maxHistoryMessages: this.ctx.plugin.settings.maxHistoryMessages
                });
                messages = result.messages;
                contextNote = result.contextNote;
            }

            // Prepare user message content for history
            const userMessageContent = isWebMode
                ? message
                : `${contextNote}\n\nRequest: ${message}`;

            // NEW: Create Turn for this message (after we know the full history content)
            const turn = createTurn(
                userMsgId,
                userMessageContent,
                contextToCapture.selectedText,
                contextToCapture.contextLabel,
                contextToCapture.selectedTextStart,
                contextToCapture.selectedTextEnd,
                message
            );
            lockedTabState.turns.push(turn);
            this.currentTurnId = turn.id; // Save turnId for error handling
            console.debug('[RequestOrchestrator] Created Turn:', turn.id);

            this.syncTurnsToStore(lockedMode);
            
            // NOW emit message:rendered for UI capture (AFTER adding to history)
            if (userMessageEl) {
                const effectiveContextText = isWebMode ? '' : (contextToUse.selectedText || '');
                const effectiveContextLabel = isWebMode ? 'Not supported' : (contextToUse.contextLabel || undefined);

                this.ctx.captureMessageRendered(userMsgId, lockedMode, {
                    contextContent: effectiveContextText,
                    contextLabel: effectiveContextLabel,
                    originalMessage: message
                });
            }
            // === END: PromptBuilder integration ===

            // NOW clear selected context (AFTER PromptBuilder captured it)
            // Don't clear if from queue - context was already cleared when added to queue
            if (!isWebMode && !lockedTabState.isContextPinned && !fromQueue) {
                this.ctx.clearSelectedText();
            }

            // Route to appropriate handler
            if (isWebMode) {
                await this.webSearchHandler.processWeb(messages, lockedMode, lockedTabState, userMessageEl, abortController);
            } else {
                await this.editDiscussHandler.processEditDiscuss(
                    messages,
                    lockedMode,
                    lockedTabState,
                    userMessageEl,
                    isEditMode,
                    abortController,
                    turn.id
                );
            }
            this.syncTurnsToStore(lockedMode);

        } catch (error: unknown) {
            this.handleError(error, lockedMode, lockedTabState, isWebMode);
        } finally {
            await this.requestService.finalizeProcessing(lockedMode);
        }
    }

    /**
     * Removes all cursors from DOM for the specified mode
     */
    private removeAllCursors(mode: 'edit' | 'discuss' | 'web') {
        this.ctx.removeAllCursorsInMode(mode);
    }

    /**
     * Error handling
     */
    private handleError(error: unknown, lockedMode: 'edit' | 'discuss' | 'web', lockedTabState: TabState, isWebMode: boolean) {
        const eventBus = this.ctx.eventBus;
        const errorName = (() => {
            if (error && typeof error === 'object' && 'name' in error) {
                const name = (error as { name?: unknown }).name;
                return typeof name === 'string' ? name : undefined;
            }
            return undefined;
        })();

        const errorMessage = (() => {
            if (error && typeof error === 'object' && 'message' in error) {
                const message = (error as { message?: unknown }).message;
                return typeof message === 'string' ? message : undefined;
            }
            return undefined;
        })();

        const isAbortError = errorName === 'AbortError';
        const isSilent = this.ctx.isSilentAbort();

        let lastStreamingMessage: HTMLElement | undefined;
        const reasoningBlock = this.ctx.findReasoningBlockElement(lockedMode, this.currentTurnId);
        const reasoningHtml = reasoningBlock?.innerHTML;
        const reasoningCollapsed = reasoningBlock?.classList.contains('collapsed');

        // FIXED: Find the active user message for current generation to get turnId
        const findActiveUserMessageId = (): string | undefined => {
            const userMessages = this.ctx.findChatElements(`.user-message[data-mode="${lockedMode}"]`);
            const active = [...userMessages]
                .reverse()
                .find((el) => !el.querySelector('.queued-status'));
            const id = active?._msgId || active?.getAttribute('data-msg-id');
            return id && id.trim().length > 0 ? id : undefined;
        };

        const activeUserMsgId = findActiveUserMessageId();
        const turnId = this.currentTurnId || activeUserMsgId; // Use saved turnId, fallback to search

        // FIXED: Find last element in current turn using turnId
        // This ensures system messages are added after all messages in the same turn
        const findLastElementInTurn = (): string | undefined => {
            if (!activeUserMsgId) {
                // Fallback: find last non-streaming message
                const msgs = this.ctx.findChatElements(
                    `.chat-message[data-mode="${lockedMode}"]:not(.welcome-message):not(.streaming-message), .reasoning-block[data-mode="${lockedMode}"]`
                );
                const last = msgs.length > 0 ? (msgs[msgs.length - 1]) : undefined;
                if (last) {
                    const id = last._msgId || last.getAttribute('data-msg-id');
                    if (id && id.trim().length > 0) {
                        return id;
                    }
                }
                return undefined;
            }

            // Find user message element
            const userMsgEl = this.ctx.findChatMessageElementById(activeUserMsgId);
            if (!userMsgEl || !userMsgEl.parentNode) {
                console.warn('[RequestOrchestrator] User message element not found:', activeUserMsgId);
                return activeUserMsgId;
            }

            // FIXED: Walk forward from user message to find last NON-system element in this turn
            // System messages (stop/error) should NOT be considered as anchors - they are appended after everything
            let lastEl: HTMLElement = userMsgEl;
            let nextEl = userMsgEl.nextElementSibling as HTMLElement | null;
            let checkedCount = 0;
            const maxCheck = 50; // Safety limit

            while (nextEl && checkedCount < maxCheck) {
                checkedCount++;
                const nextTurnId = nextEl.getAttribute('data-turn-id');
                const isActiveUserMessage = nextEl.classList.contains('user-message') &&
                                           !nextEl.querySelector('.queued-status');
                const nextMode = nextEl.getAttribute('data-mode');
                const isSystemMessage = nextEl.classList.contains('system-message');
                
                // Stop if different turn, different mode, or hit active user message from another turn
                if ((nextTurnId && nextTurnId !== turnId) || 
                    (isActiveUserMessage && nextEl.getAttribute('data-msg-id') !== activeUserMsgId) ||
                    (nextMode && nextMode !== lockedMode)) {
                    break;
                }
                
                // FIXED: In web mode, system messages (like "✓ Found 3 sites") are part of normal flow - include them
                // In edit/discuss modes, system messages are only errors/stop - skip them
                if (isWebMode) {
                    // In web mode: include all elements (system messages are part of agent flow)
                    lastEl = nextEl;
                } else {
                    // In edit/discuss modes: skip system messages (they are only errors/stop)
                    if (!isSystemMessage) {
                        lastEl = nextEl;
                    }
                }
                
                nextEl = nextEl.nextElementSibling as HTMLElement | null;
            }

            // Extract ID: prefer data-msg-id, but also check for reasoning blocks
            const lastMsgId = lastEl.getAttribute('data-msg-id');
            if (lastMsgId && lastMsgId.trim().length > 0) {
                console.debug('[RequestOrchestrator] Found last NON-system element ID in turn:', lastMsgId, 'element type:', lastEl.className);
                return lastMsgId;
            }
            
            // For reasoning blocks - they should have msg-id set when created, but if not, use the element itself
            if (lastEl.classList.contains('reasoning-block')) {
                // Try to get reasoning ID from the reasoning renderer
                if (turnId) {
                    const reasoningBlock = this.ctx.findReasoningBlockElement(lockedMode, turnId);
                    if (reasoningBlock && reasoningBlock.getAttribute('data-turn-id') === turnId) {
                        const reasoningId = reasoningBlock.getAttribute('data-msg-id');
                        if (reasoningId && reasoningId.trim().length > 0) {
                            console.debug('[RequestOrchestrator] Found reasoning block ID:', reasoningId);
                            return reasoningId;
                        }
                    }
                }
                // If reasoning block has no ID, we need to find it by walking from user message
                // But for now, return user msg id and let system-message-renderer handle it
                console.warn('[RequestOrchestrator] Reasoning block found but no ID, using user msg id as fallback');
            }
            
            // Fallback: return active user message ID
            console.debug('[RequestOrchestrator] Using user message ID as fallback:', activeUserMsgId);
            return activeUserMsgId;
        };

        const resolveAfterId = (anchor: HTMLElement | undefined): string | undefined => {
            if (!anchor) return findLastElementInTurn();
            const direct = anchor._msgId || anchor.getAttribute('data-msg-id');
            if (direct && direct.trim().length > 0) return direct;

            // If anchor is a reasoning block (often has no msg-id), fall back to the nearest previous sibling with an id.
            let current: HTMLElement | null = anchor;
            for (let i = 0; i < 15; i++) {
                current = current.previousElementSibling as HTMLElement | null;
                if (!current) break;
                const id = current._msgId || current.getAttribute('data-msg-id');
                if (id && id.trim().length > 0) return id;
            }
            return findLastElementInTurn();
        };

        this.ctx.setSilentAbort(false);

        if (isAbortError) {
            if (isSilent) {
                this.ctx.removeAllStreamingMessages();
                return;
            }

            this.removeAllCursors(lockedMode);

            const streamingMessages = this.ctx.findChatElements('.streaming-message');

            // FIXED: Find last element BEFORE clearing streaming messages
            // This ensures we have a valid anchor even after elements are removed

            streamingMessages.forEach((msgEl) => {
                if (msgEl.getAttribute('data-mode') === lockedMode) {
                    lastStreamingMessage = msgEl;
                }

                const contentEl = msgEl.querySelector('.message-content');
                if (contentEl) {
                    const content = contentEl.textContent || '';
                    const trimmedContent = content.trim();
                    const isResultMessage = msgEl.classList.contains('result-message') ||
                        !!msgEl.getAttribute('data-edit-number');
                    const editAttr = msgEl.getAttribute('data-edit-number');
                    const editNumber = editAttr ? parseInt(editAttr, 10) || undefined : undefined;
                    const currentTurn = turnId
                        ? lockedTabState.turns.find(t => t.id === turnId)
                        : undefined;

                    if (currentTurn && reasoningHtml && !currentTurn.reasoning) {
                        const reasoningText = extractTextFromReasoningHtml(reasoningHtml);
                        if (reasoningText) {
                            addReasoningToTurn(currentTurn, `${turnId}-reasoning`, reasoningText, reasoningCollapsed);
                        }
                    }

                    if (trimmedContent.length > 0) {
                        const msgId = msgEl._msgId || msgEl.getAttribute('data-msg-id') || this.ctx.generateMessageId();
                        if (!msgEl.getAttribute('data-msg-id')) {
                            msgEl.setAttribute('data-msg-id', msgId);
                        }

                        // Update Turn with assistant message
                        if (currentTurn) {
                            if (isResultMessage) {
                                addResultToTurn(currentTurn, msgId, trimmedContent, 'streaming', editNumber);
                            } else {
                                addAssistantToTurn(currentTurn, msgId, trimmedContent);
                            }
                            console.debug('[RequestOrchestrator] Updated Turn with assistant:', turnId);
                        }
                    }
                }

                msgEl.classList.remove('streaming-message');
            });

            const reasoningEl = this.ctx.findReasoningBlockElement(lockedMode, turnId);
            if (reasoningEl && reasoningEl.isConnected) {
                let reasoningId = reasoningEl.getAttribute('data-msg-id') || reasoningEl._msgId;
                if (!reasoningId) {
                    reasoningId = this.ctx.generateMessageId();
                    reasoningEl.setAttribute('data-msg-id', reasoningId);
                    reasoningEl._msgId = reasoningId;
                }
            }

            // Prefer last NON-system element in the turn (assistant/result if present, reasoning otherwise).
            const stopAfterId = findLastElementInTurn();
            
            console.debug('[RequestOrchestrator] Stop message afterId:', stopAfterId, 'turnId:', turnId);

            // Now clear streaming (may remove elements, but we already have afterId)
            eventBus.emit('render:clearStreaming', { mode: lockedMode });

            const stopMsgId = this.ctx.generateMessageId();

            // THEN render UI using the saved afterId
            eventBus.emit('render:addSystemMessage', {
                content: 'Generation stopped',
                isStopMessage: true,
                mode: lockedMode,
                afterId: stopAfterId,
                messageId: stopMsgId,
                turnId: turnId
            });

            this.ctx.captureMessageRendered(stopMsgId, lockedMode, {
                isStopMessage: true,
                originalMessage: 'Generation stopped'
            });
            
            Actions.setCalculating(this.ctx.store, lockedMode, false);
            this.syncTurnsToStore(lockedMode);
            this.ctx.eventBus.emit('generation:stopped', { tab: lockedMode });
        } else {
            // FIXED: Anchor the error message BEFORE removing streaming messages
            // Find last element before clearing to ensure we have a valid anchor
            const streamingMessages = this.ctx.findChatElements('.streaming-message');
            streamingMessages.forEach((msgEl) => {
                if (msgEl.getAttribute('data-mode') === lockedMode) {
                    lastStreamingMessage = msgEl;
                }
            });

            if (turnId && reasoningHtml) {
                const currentTurn = lockedTabState.turns.find(t => t.id === turnId);
                if (currentTurn && !currentTurn.reasoning) {
                    const reasoningText = extractTextFromReasoningHtml(reasoningHtml);
                    if (reasoningText) {
                        addReasoningToTurn(currentTurn, `${turnId}-reasoning`, reasoningText, reasoningCollapsed);
                    }
                }
            }

            // FIXED: Always use findLastElementInTurn to find last NON-system element in turn
            // This ensures error messages appear after the actual content
            const errorAfterId = findLastElementInTurn();
            
            console.debug('[RequestOrchestrator] Error message afterId:', errorAfterId, 'turnId:', turnId);

            // Now remove streaming messages (they may be deleted, but we have afterId)
            this.ctx.removeAllStreamingMessages();

            const errorMsgId = this.ctx.generateMessageId();
            
            const message = errorMessage || 'Unknown error';
            
            // THEN render UI
            eventBus.emit('render:addSystemMessage', {
                content: 'Error: ' + message,
                mode: lockedMode,
                isError: true,
                afterId: errorAfterId,
                messageId: errorMsgId,
                turnId: turnId
            });

            this.ctx.captureMessageRendered(errorMsgId, lockedMode, {
                isError: true,
                originalMessage: 'Error: ' + message
            });
            
            Actions.setCalculating(this.ctx.store, lockedMode, false);
            this.syncTurnsToStore(lockedMode);
            this.ctx.eventBus.emit('generation:error', { tab: lockedMode, error: message });
        }
    }
}
