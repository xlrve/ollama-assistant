import type { RequestProcessorContext } from './request-context';
import { Actions } from '../core/actions';
import type OllamaAssistantPlugin from '../../main';
import type { QueuedRequest, TabState } from '../types';
import type { Store } from '../core/store';
import type { App } from 'obsidian';
import type { EventBus, EventMap } from '../core/event-bus';

export type RequestProcessorContextDeps = {
    plugin: OllamaAssistantPlugin;
    app: App;

    // Tab state management
    getCurrentTab: () => 'edit' | 'discuss' | 'web';
    getTabState: (mode: 'edit' | 'discuss' | 'web') => TabState;
    getCurrentTabState: () => TabState;
    getTabStates: () => { edit: TabState; discuss: TabState; web: TabState };

    // Processing state
    getIsProcessing: () => boolean;
    setProcessing: (value: boolean) => void;
    setProcessingTab: (tab: 'edit' | 'discuss' | 'web' | null) => void;

    // Request queue
    getRequestQueue: () => QueuedRequest[];
    setRequestQueue: (queue: QueuedRequest[]) => void;

    // Abort controller
    setCurrentAbortController: (controller: AbortController | null) => void;

    // Silent abort flag
    isSilentAbort: () => boolean;
    setSilentAbort: (value: boolean) => void;

    // Edit tracking
    getEditCounter: () => number;
    setEditCounter: (value: number) => void;
    getCurrentEditNumber: () => number;
    setCurrentEditNumber: (value: number) => void;
    setEditPosition: (
        editNumber: number,
        position: {
            text: string;
            start: number;
            end: number;
            isWholeNote: boolean;
            anchorBefore?: string;
            anchorAfter?: string;
        }
    ) => void;

    // Generation metrics
    getGenerationTokenCount: () => number;
    setGenerationTokenCount: (value: number) => void;
    getCurrentGenerationSpeed: () => number;
    setCurrentGenerationSpeed: (value: number) => void;

    // UI methods
    updateSendButtonState: (processing: boolean) => void;
    updateTabIndicators: () => void;
    scrollToBottom: (force?: boolean) => void;
    clearSelectedText: () => void;

    // UI ports (DOM helpers)
    getChatMessagesContainer: () => HTMLElement | null;
    findChatMessageElementById: (messageId: string) => HTMLElement | null;
    findChatElements: (selector: string) => HTMLElement[];
    findReasoningBlockElement: (mode: 'edit' | 'discuss' | 'web', turnId?: string) => HTMLElement | null;
    removeAllCursorsInMode: (mode: 'edit' | 'discuss' | 'web') => void;
    removeAllStreamingMessages: (mode?: 'edit' | 'discuss' | 'web') => void;
    findAbortInsertAnchor: (mode: 'edit' | 'discuss' | 'web', isWebMode: boolean) => HTMLElement | null;
    getReasoningUiDataForMessage: (
        messageId: string,
        mode: 'edit' | 'discuss' | 'web'
    ) => { reasoningHtml?: string; reasoningCollapsed?: boolean } | null;
    captureMessageRendered: (
        messageId: string,
        mode: 'edit' | 'discuss' | 'web',
        uiData: EventMap['message:rendered']['uiData']
    ) => void;

    // Streaming throttle
    clearStreamingThrottle: () => void;

    // ID generation
    generateMessageId: () => string;

    // History management
    saveChatHistory: () => Promise<void>;

    // Event-driven bridge
    eventBus: EventBus;

    // Store
    store: Store;
};

/**
 * Factory for RequestProcessorContext.
 *
 * This intentionally accepts explicit deps (no `view: any`) to avoid "view-as-context".
 */
export function createRequestProcessorContext(deps: RequestProcessorContextDeps): RequestProcessorContext {
    return {
        plugin: deps.plugin,
        app: deps.app,

        getCurrentTab: deps.getCurrentTab,
        getTabState: deps.getTabState,
        getCurrentTabState: deps.getCurrentTabState,
        getTabStates: deps.getTabStates,

        get isProcessing() {
            return deps.getIsProcessing();
        },
        setProcessing: (value) => {
            deps.setProcessing(value);
        },
        setProcessingTab: (tab) => {
            deps.setProcessingTab(tab);
        },

        getRequestQueue: () => deps.getRequestQueue(),
        setRequestQueue: (queue) => {
            deps.setRequestQueue(queue);
        },

        setCurrentAbortController: (controller) => {
            deps.setCurrentAbortController(controller);
        },

        getEditCounter: () => deps.getEditCounter(),
        setEditCounter: (value) => {
            deps.setEditCounter(value);
        },
        getCurrentEditNumber: () => deps.getCurrentEditNumber(),
        setCurrentEditNumber: (value) => {
            deps.setCurrentEditNumber(value);
        },
        setEditPosition: (editNumber, position) => {
            deps.setEditPosition(editNumber, position);
            Actions.setEditPosition(deps.store, editNumber, position);
        },

        getGenerationTokenCount: () => deps.getGenerationTokenCount(),
        setGenerationTokenCount: (value) => {
            deps.setGenerationTokenCount(value);
        },
        getCurrentGenerationSpeed: () => deps.getCurrentGenerationSpeed(),
        setCurrentGenerationSpeed: (value) => {
            deps.setCurrentGenerationSpeed(value);
        },

        updateSendButtonState: (processing) => deps.updateSendButtonState(processing),
        updateTabIndicators: () => deps.updateTabIndicators(),
        scrollToBottom: (force) => deps.scrollToBottom(force),
        clearSelectedText: () => deps.clearSelectedText(),

        // UI ports
        getChatMessagesContainer: () => deps.getChatMessagesContainer(),
        findChatMessageElementById: (messageId: string) => deps.findChatMessageElementById(messageId),
        findChatElements: (selector: string) => deps.findChatElements(selector),
        findReasoningBlockElement: (mode, turnId) => deps.findReasoningBlockElement(mode, turnId),
        removeAllCursorsInMode: (mode) => deps.removeAllCursorsInMode(mode),
        removeAllStreamingMessages: (mode) => deps.removeAllStreamingMessages(mode),
        findAbortInsertAnchor: (mode, isWebMode) => deps.findAbortInsertAnchor(mode, isWebMode),
        getReasoningUiDataForMessage: (messageId, mode) => deps.getReasoningUiDataForMessage(messageId, mode),
        captureMessageRendered: (messageId, mode, uiData) => deps.captureMessageRendered(messageId, mode, uiData),

        clearStreamingThrottle: () => deps.clearStreamingThrottle(),
        generateMessageId: () => deps.generateMessageId(),

        saveChatHistory: () => deps.saveChatHistory(),

        isSilentAbort: () => deps.isSilentAbort(),
        setSilentAbort: (value) => {
            deps.setSilentAbort(value);
        },

        eventBus: deps.eventBus,
        store: deps.store
    };
}
