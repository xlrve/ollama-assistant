export const CHAT_VIEW_TYPE = 'ollama-chat-view';

export interface QueuedRequest {
    mode: 'edit' | 'discuss' | 'web';
    message: string;
    userMessageEl: HTMLElement;
    turnId?: string; // ID of the Turn for this request
    // Saved context at the time of queueing
    savedContext: {
        selectedText: string;
        selectedTextStart: number;
        selectedTextEnd: number;
        contextLabel?: string;
    };
}

/**
 * Turn - normalized model of one conversation exchange
 * Structure guarantees correct message order:
 *
 * Edit mode:   user → reasoning? → assistant → errors[]
 * Discuss mode: user → reasoning? → assistant → errors[]
 * Web mode:    user → reasoning? → systemMessages[] → assistant → errors[]
 */
export interface Turn {
    id: string; // Turn ID (usually user message ID)
    user: {
        id: string;
        content: string;
        timestamp: number;
        contextContent?: string;
        contextLabel?: string;
        contextStart?: number;
        contextEnd?: number;
        originalMessage?: string;
    };
    reasoning?: {
        id: string;
        content: string;
        collapsed: boolean;
    };
    // System messages (for Web mode - live search/fetch status updates)
    systemMessages: Array<{
        id: string;
        content: string;
        timestamp: number;
    }>;
    assistant?: {
        id: string;
        content: string;
        timestamp: number;
        status: 'queued' | 'streaming' | 'final';
    };
    // Edit mode result (Apply/Keep/Add to context)
    result?: {
        id: string;
        content: string;
        timestamp: number;
        status: 'queued' | 'streaming' | 'final';
        editNumber?: number;
        positionData?: {
            text: string;
            start: number;
            end: number;
            isWholeNote: boolean;
            anchorBefore?: string;
            anchorAfter?: string;
        };
    };
    // Error messages (multiple errors possible in one turn)
    errors: Array<{
        id: string;
        content: string;
        timestamp: number;
    }>;
    // Stop message (always last, after errors)
    stopMessage?: {
        id: string;
        content: string;
        timestamp: number;
    };
}

export interface TabState {
    // NEW: Normalized Turn model
    turns: Turn[];
    selectedText: string;
    selectedTextStart: number;
    selectedTextEnd: number;
    textareaContent: string;
    reasoningBlockEl: HTMLElement | null;
    isCalculating: boolean;
    contextLabel?: string; // Custom label for context (e.g., "Edit 1", "Entire note")
    isContextPinned: boolean; // Whether context should persist after sending message

    // Last generation metrics from Ollama (real token counts)
    lastPromptTokens: number;
    lastResponseTokens: number;

    // Scroll position (runtime only, not persisted)
    scrollPosition: number;
}
