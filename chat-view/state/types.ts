/**
 * State types - description of entire application state
 * Single Source of Truth
 */

// Import base types
import type { QueuedRequest, TabState } from '../types';

// Re-export for convenience
export type { QueuedRequest, TabState };

/**
 * Data for edit position
 */
export interface EditPosition {
    text: string;              // Original text (for search/undo compatibility)
    appliedContent?: string;   // Content currently in document after apply (for chain search)
    appliedStart?: number;     // Position after apply
    appliedEnd?: number;
    start: number;
    end: number;
    isWholeNote: boolean;
    anchorBefore?: string;
    anchorAfter?: string;
}

/**
 * Pending edit
 */
export interface PendingEdit {
    content: string;
    editNumber: number;
}

/**
 * Edits state
 */
export interface EditsState {
    counter: number;
    currentEditNumber: number;
    positions: Map<number, EditPosition>;
    context: Map<number, string>;
    pending: PendingEdit | null;
    chains: Map<number, number[]>;  // editNumber → [parent, grandparent, ...]
}

/**
 * Request queue state
 */
export interface RequestQueueState {
    queue: QueuedRequest[];
    processingTab: 'edit' | 'discuss' | 'web' | null;
    currentAbortController: AbortController | null;
    silentAbort: boolean; // Suppress "Generation stopped" when clearing
}

/**
 * Generation metrics
 */
export interface GenerationMetrics {
    startTime: number;
    tokenCount: number;
    speed: number; // tokens per second
}

/**
 * UI state
 */
export interface UIState {
    // Mode
    currentTab: 'edit' | 'discuss' | 'web';

    // Processing
    isProcessing: boolean;

    // Connection
    isConnected: boolean;
    currentModelSupportsTools: boolean;

    // Current note
    currentNoteContent: string;

    // Generation metrics
    generation: GenerationMetrics;
}

/**
 * Full application state
 */
export interface AppState {
    // UI state
    ui: UIState;

    // Tab states
    tabs: {
        edit: TabState;
        discuss: TabState;
        web: TabState;
    };

    // Edits
    edits: EditsState;

    // Request queue
    queue: RequestQueueState;
}

/**
 * Initial tab state
 */
export function createInitialTabState(): TabState {
    return {
        turns: [],
        selectedText: '',
        selectedTextStart: 0,
        selectedTextEnd: 0,
        textareaContent: '',
        reasoningBlockEl: null,
        isCalculating: false,
        isContextPinned: false,
        lastPromptTokens: 0,
        lastResponseTokens: 0,
        scrollPosition: 0
    };
}

/**
 * Initial application state
 */
export function createInitialAppState(): AppState {
    return {
        ui: {
            currentTab: 'edit',
            isProcessing: false,
            isConnected: false,
            currentModelSupportsTools: false,
            currentNoteContent: '',
            generation: {
                startTime: 0,
                tokenCount: 0,
                speed: 0
            }
        },
        tabs: {
            edit: createInitialTabState(),
            discuss: createInitialTabState(),
            web: createInitialTabState()
        },
        edits: {
            counter: 0,
            currentEditNumber: 0,
            positions: new Map(),
            context: new Map(),
            pending: null,
            chains: new Map()
        },
        queue: {
            queue: [],
            processingTab: null,
            currentAbortController: null,
            silentAbort: false
        }
    };
}
