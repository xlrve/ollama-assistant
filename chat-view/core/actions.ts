/**
 * Actions - functions for modifying Store state
 * All state changes must go through actions
 */

import type { Store } from './store';
import type { TabState, PendingEdit, EditPosition } from '../state/types';
import type { Turn } from '../types';

/**
 * Class for centralized state management
 * All methods accept Store and modify it immutably
 */
export class Actions {
    /**
     * === Mode actions ===
     */
    static switchMode(
        store: Store,
        mode: 'edit' | 'discuss' | 'web'
    ): void {
        store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                currentTab: mode
            }
        }));
    }

    /**
     * === Processing actions ===
     */
    static startProcessing(
        store: Store,
        tab: 'edit' | 'discuss' | 'web'
    ): void {
        store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                isProcessing: true
            },
            queue: {
                ...state.queue,
                processingTab: tab
            }
        }));
    }

    static stopProcessing(store: Store): void {
        store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                isProcessing: false
            },
            queue: {
                ...state.queue,
                processingTab: null,
                currentAbortController: null
            }
        }));
    }

    /**
     * === Turn actions ===
     */
    static setTurns(
        store: Store,
        tab: 'edit' | 'discuss' | 'web',
        turns: Turn[]
    ): void {
        store.setState(state => ({
            ...state,
            tabs: {
                ...state.tabs,
                [tab]: {
                    ...state.tabs[tab],
                    turns: [...turns]
                }
            }
        }));
    }

    static clearMessages(
        store: Store,
        tab: 'edit' | 'discuss' | 'web'
    ): void {
        store.setState(state => ({
            ...state,
            tabs: {
                ...state.tabs,
                [tab]: {
                    ...state.tabs[tab],
                    turns: []
                }
            }
        }));
    }

    static clearAllMessages(store: Store): void {
        store.setState(state => ({
            ...state,
            tabs: {
                edit: { ...state.tabs.edit, turns: [] },
                discuss: { ...state.tabs.discuss, turns: [] },
                web: { ...state.tabs.web, turns: [] }
            }
        }));
    }

    /**
     * === Context actions ===
     */
    static setContext(
        store: Store,
        tab: 'edit' | 'discuss' | 'web',
        text: string,
        start: number = 0,
        end: number = 0,
        label?: string
    ): void {
        store.setState(state => ({
            ...state,
            tabs: {
                ...state.tabs,
                [tab]: {
                    ...state.tabs[tab],
                    selectedText: text,
                    selectedTextStart: start,
                    selectedTextEnd: end,
                    contextLabel: label
                }
            }
        }));
    }

    static clearContext(
        store: Store,
        tab: 'edit' | 'discuss' | 'web'
    ): void {
        store.setState(state => ({
            ...state,
            tabs: {
                ...state.tabs,
                [tab]: {
                    ...state.tabs[tab],
                    selectedText: '',
                    selectedTextStart: 0,
                    selectedTextEnd: 0,
                    contextLabel: undefined,
                    isContextPinned: false
                }
            }
        }));
    }

    static pinContext(
        store: Store,
        tab: 'edit' | 'discuss' | 'web',
        pinned: boolean
    ): void {
        store.setState(state => ({
            ...state,
            tabs: {
                ...state.tabs,
                [tab]: {
                    ...state.tabs[tab],
                    isContextPinned: pinned
                }
            }
        }));
    }

    /**
     * === Edit tracking actions ===
     */
    static incrementEditCounter(store: Store): number {
        let editNumber = 0;
        store.setState(state => {
            editNumber = state.edits.counter + 1;
            return {
                ...state,
                edits: {
                    ...state.edits,
                    counter: editNumber,
                    currentEditNumber: editNumber
                }
            };
        });
        return editNumber;
    }

    static setEditCounter(
        store: Store,
        counter: number
    ): void {
        store.setState(state => ({
            ...state,
            edits: {
                ...state.edits,
                counter
            }
        }));
    }

    static setCurrentEditNumber(
        store: Store,
        editNumber: number
    ): void {
        store.setState(state => ({
            ...state,
            edits: {
                ...state.edits,
                currentEditNumber: editNumber
            }
        }));
    }

    static setEditPosition(
        store: Store,
        editNumber: number,
        position: EditPosition
    ): void {
        store.setState(state => {
            const newPositions = new Map(state.edits.positions);
            newPositions.set(editNumber, position);
            return {
                ...state,
                edits: {
                    ...state.edits,
                    positions: newPositions
                }
            };
        });
    }

    static setEditContext(
        store: Store,
        editNumber: number,
        content: string
    ): void {
        store.setState(state => {
            const newContext = new Map(state.edits.context);
            newContext.set(editNumber, content);
            return {
                ...state,
                edits: {
                    ...state.edits,
                    context: newContext
                }
            };
        });
    }

    /**
     * Link edit to its parent edit (for edit chains)
     * Builds chain: [parent, grandparent, ...]
     */
    static linkEditChain(
        store: Store,
        editNumber: number,
        sourceEditNumber: number
    ): void {
        store.setState(state => {
            const newChains = new Map(state.edits.chains);
            // Get parent's chain and prepend parent to it
            const parentChain = state.edits.chains.get(sourceEditNumber) || [];
            newChains.set(editNumber, [sourceEditNumber, ...parentChain]);
            return {
                ...state,
                edits: {
                    ...state.edits,
                    chains: newChains
                }
            };
        });
    }

    /**
     * Set edit chain directly (for restoring from saved state)
     */
    static setEditChain(
        store: Store,
        editNumber: number,
        chain: number[]
    ): void {
        store.setState(state => {
            const newChains = new Map(state.edits.chains);
            newChains.set(editNumber, chain);
            return {
                ...state,
                edits: {
                    ...state.edits,
                    chains: newChains
                }
            };
        });
    }

    /**
     * Clear all edit positions (when clearing history)
     */
    static clearEditPositions(store: Store): void {
        store.setState(state => ({
            ...state,
            edits: {
                ...state.edits,
                positions: new Map()
            }
        }));
    }

    /**
     * Clear all edit chains (when clearing history)
     */
    static clearEditChains(store: Store): void {
        store.setState(state => ({
            ...state,
            edits: {
                ...state.edits,
                chains: new Map()
            }
        }));
    }

    static setPendingEdit(
        store: Store,
        edit: PendingEdit | null
    ): void {
        store.setState(state => ({
            ...state,
            edits: {
                ...state.edits,
                pending: edit
            }
        }));
    }

    /**
     * === Queue actions ===
     */
    static setAbortController(
        store: Store,
        controller: AbortController | null
    ): void {
        store.setState(state => ({
            ...state,
            queue: {
                ...state.queue,
                currentAbortController: controller
            }
        }));
    }

    static setSilentAbort(
        store: Store,
        silent: boolean
    ): void {
        store.setState(state => ({
            ...state,
            queue: {
                ...state.queue,
                silentAbort: silent
            }
        }));
    }

    /**
     * === Calculating state actions ===
     */
    static setCalculating(
        store: Store,
        tab: 'edit' | 'discuss' | 'web',
        isCalculating: boolean
    ): void {
        store.setState(state => ({
            ...state,
            tabs: {
                ...state.tabs,
                [tab]: {
                    ...state.tabs[tab],
                    isCalculating
                }
            }
        }));
    }

    /**
     * === Token metrics actions ===
     */
    static setTokenMetrics(
        store: Store,
        tab: 'edit' | 'discuss' | 'web',
        promptTokens: number,
        responseTokens: number,
        accumulate: boolean = false
    ): void {
        store.setState(state => {
            const currentTab = state.tabs[tab];
            return {
                ...state,
                tabs: {
                    ...state.tabs,
                    [tab]: {
                        ...currentTab,
                        lastPromptTokens: accumulate
                            ? currentTab.lastPromptTokens + promptTokens
                            : promptTokens,
                        lastResponseTokens: accumulate
                            ? currentTab.lastResponseTokens + responseTokens
                            : responseTokens
                    }
                }
            };
        });
    }

    /**
     * Reset token metrics for all tabs
     * Used when model changes - old tokens are no longer relevant
     */
    static resetAllTokenMetrics(store: Store): void {
        store.setState(state => ({
            ...state,
            tabs: {
                edit: {
                    ...state.tabs.edit,
                    lastPromptTokens: 0,
                    lastResponseTokens: 0
                },
                discuss: {
                    ...state.tabs.discuss,
                    lastPromptTokens: 0,
                    lastResponseTokens: 0
                },
                web: {
                    ...state.tabs.web,
                    lastPromptTokens: 0,
                    lastResponseTokens: 0
                }
            }
        }));
    }

    /**
     * === Connection actions ===
     */
    static setConnected(
        store: Store,
        connected: boolean
    ): void {
        store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                isConnected: connected
            }
        }));
    }

    static setModelSupportsTools(
        store: Store,
        supports: boolean
    ): void {
        store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                currentModelSupportsTools: supports
            }
        }));
    }

    /**
     * === Generation metrics ===
     */
    static setGenerationMetrics(
        store: Store,
        metrics: Partial<{ startTime: number; tokenCount: number; speed: number }>
    ): void {
        store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                generation: {
                    ...state.ui.generation,
                    ...metrics
                }
            }
        }));
    }

    static updateGenerationSpeed(
        store: Store,
        speed: number
    ): void {
        store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                generation: {
                    ...state.ui.generation,
                    speed
                }
            }
        }));
    }

    /**
     * === Textarea content ===
     */
    static setTextareaContent(
        store: Store,
        tab: 'edit' | 'discuss' | 'web',
        content: string
    ): void {
        store.setState(state => ({
            ...state,
            tabs: {
                ...state.tabs,
                [tab]: {
                    ...state.tabs[tab],
                    textareaContent: content
                }
            }
        }));
    }

    static clearTextareaContent(
        store: Store,
        tab: 'edit' | 'discuss' | 'web'
    ): void {
        store.setState(state => ({
            ...state,
            tabs: {
                ...state.tabs,
                [tab]: {
                    ...state.tabs[tab],
                    textareaContent: ''
                }
            }
        }));
    }

    static clearAllTextareas(store: Store): void {
        store.setState(state => ({
            ...state,
            tabs: {
                edit: {
                    ...state.tabs.edit,
                    textareaContent: ''
                },
                discuss: {
                    ...state.tabs.discuss,
                    textareaContent: ''
                },
                web: {
                    ...state.tabs.web,
                    textareaContent: ''
                }
            }
        }));
    }

    /**
     * === Note content ===
     */
    static setNoteContent(
        store: Store,
        content: string
    ): void {
        store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                currentNoteContent: content
            }
        }));
    }

}
