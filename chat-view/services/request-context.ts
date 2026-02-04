import type OllamaAssistantPlugin from '../../main';
import type { QueuedRequest, TabState } from '../types';
import type { Store } from '../core/store';
import type { App } from 'obsidian';
import type { EventBus, EventMap } from '../core/event-bus';

/**
 * Request context (extracted from request-processor.ts)
 * Maintains compatibility with existing services.
 */
export interface RequestProcessorContext {
    // Plugin and App
    plugin: OllamaAssistantPlugin;
    app: App;

    // Tab state management
    getCurrentTab(): 'edit' | 'discuss' | 'web';
    getTabState(mode: 'edit' | 'discuss' | 'web'): TabState;
    getCurrentTabState(): TabState;
    getTabStates(): { edit: TabState; discuss: TabState; web: TabState };

    // Processing state
    isProcessing: boolean;
    setProcessing(value: boolean): void;
    setProcessingTab(tab: 'edit' | 'discuss' | 'web' | null): void;

    // Request queue
    getRequestQueue(): QueuedRequest[];
    setRequestQueue(queue: QueuedRequest[]): void;

    // Abort controller
    setCurrentAbortController(controller: AbortController | null): void;

    // Silent abort flag (when clearing history, don't show "Generation stopped")
    isSilentAbort(): boolean;
    setSilentAbort(value: boolean): void;

    // Edit tracking
    getEditCounter(): number;
    setEditCounter(value: number): void;
    getCurrentEditNumber(): number;
    setCurrentEditNumber(value: number): void;
    setEditPosition(
        editNumber: number,
        position: {
            text: string;
            start: number;
            end: number;
            isWholeNote: boolean;
            anchorBefore?: string;
            anchorAfter?: string;
        }
    ): void;

    // Generation metrics
    getGenerationTokenCount(): number;
    setGenerationTokenCount(value: number): void;
    getCurrentGenerationSpeed(): number;
    setCurrentGenerationSpeed(value: number): void;

    // UI methods
    updateSendButtonState(processing: boolean): void;
    updateTabIndicators(): void;
    scrollToBottom(force?: boolean): void;
    clearSelectedText(): void;

    // UI ports (DOM helpers) — implemented by ChatView
    getChatMessagesContainer(): HTMLElement | null;
    findChatMessageElementById(messageId: string): HTMLElement | null;
    findChatElements(selector: string): HTMLElement[];
    findReasoningBlockElement(mode: 'edit' | 'discuss' | 'web', turnId?: string): HTMLElement | null;
    removeAllCursorsInMode(mode: 'edit' | 'discuss' | 'web'): void;
    removeAllStreamingMessages(mode?: 'edit' | 'discuss' | 'web'): void;
    findAbortInsertAnchor(mode: 'edit' | 'discuss' | 'web', isWebMode: boolean): HTMLElement | null;
    getReasoningUiDataForMessage(
        messageId: string,
        mode: 'edit' | 'discuss' | 'web'
    ): { reasoningHtml?: string; reasoningCollapsed?: boolean } | null;
    captureMessageRendered(
        messageId: string,
        mode: 'edit' | 'discuss' | 'web',
        uiData: EventMap['message:rendered']['uiData']
    ): void;

    // Streaming throttle
    clearStreamingThrottle(): void;

    // ID generation
    generateMessageId(): string;

    // History management
    saveChatHistory(): Promise<void>;

    // NEW: Event-Driven bridge (for incremental migration)
    eventBus: EventBus;

    // Store for status indicators
    store: Store;
}
