import type OllamaAssistantPlugin from '../../main';
import type { EventBus } from '../core/event-bus';
import type { TabState } from '../types';
import type { EditPosition } from '../state/types';
import { Actions } from '../core/actions';
import type { Store } from '../core/store';
import { extractTextFromReasoningHtml } from '../utils/reasoning-utils';

interface HistoryServiceDeps {
    plugin: OllamaAssistantPlugin;
    eventBus: EventBus;
    store: Store;
    getTabStates: () => { edit: TabState; discuss: TabState; web: TabState };
    getEditCounter: () => number;
    setEditCounter: (value: number) => void;
    getCurrentTab: () => 'edit' | 'discuss' | 'web';
    filterMessagesByMode: (skipScroll?: boolean) => void;

    // Edit positions and chains for persistence
    getEditPositionMap: () => Map<number, EditPosition>;
    getEditChains: () => Map<number, number[]>;
    setEditPosition: (editNumber: number, position: EditPosition) => void;
    setEditChain: (editNumber: number, chain: number[]) => void;
    clearEditPositions: () => void;
    clearEditChains: () => void;

    // UI ports (DOM access must go through ChatView)
    getChatMessagesContainer: () => HTMLElement | null;
    findChatElements: (selector: string) => HTMLElement[];
}

/**
 * HistoryService - chat history storage, loading and reconstruction.
 * Handles settings logic and event-driven restoration.
 */
export class HistoryService {
    constructor(private deps: HistoryServiceDeps) {
        // Subscribe to history:save event to persist after Apply
        this.deps.eventBus.on('history:save', () => {
            void this.saveHistory();
        });
    }

    /**
     * Capture UI state from DOM before saving.
     * This is the reliable approach - scan DOM once before save.
     */
    private captureUIState(): void {
        const messagesContainer = this.deps.getChatMessagesContainer();
        if (!messagesContainer) {
            console.warn('[HistoryService] captureUIState: messagesContainer not found!');
            return;
        }

        console.debug('[HistoryService] captureUIState: starting capture...');

        const modes: ('edit' | 'discuss' | 'web')[] = ['edit', 'discuss', 'web'];
        const tabStates = this.deps.getTabStates();

        modes.forEach((mode) => {
            const turns = tabStates[mode].turns;
            if (!turns.length) return;

            const turnMap = new Map(turns.map((turn) => [turn.id, turn]));
            const reasoningBlocks = this.deps.findChatElements(`.reasoning-block[data-mode="${mode}"]`);

            reasoningBlocks.forEach((blockEl) => {
                const turnId = blockEl.getAttribute('data-turn-id');
                if (!turnId) return;
                const turn = turnMap.get(turnId);
                if (!turn) return;

                const cloned = blockEl.cloneNode(true) as HTMLElement;
                cloned.querySelectorAll('.cursor-blink').forEach((el) => el.remove());

                const reasoningText = extractTextFromReasoningHtml(cloned.innerHTML);
                if (!reasoningText) return;

                const reasoningId = blockEl.getAttribute('data-msg-id') || `${turnId}-reasoning`;
                const collapsed = blockEl.classList.contains('collapsed');

                if (!turn.reasoning) {
                    turn.reasoning = {
                        id: reasoningId,
                        content: reasoningText,
                        collapsed
                    };
                } else {
                    turn.reasoning.id = reasoningId;
                    turn.reasoning.content = reasoningText;
                    turn.reasoning.collapsed = collapsed;
                }
            });
        });

        console.debug('[HistoryService] captureUIState: done');
    }

    /**
     * Rebuild chat UI from saved history using TurnRenderer
     */
    private rebuildChatUI(): void {
        const messagesContainer = this.deps.getChatMessagesContainer();
        if (!messagesContainer) return;

        console.debug('[HistoryService] rebuildChatUI called - using TurnRenderer');

        // Clear all messages
        messagesContainer.empty();

        const modes: ('edit' | 'discuss' | 'web')[] = ['edit', 'discuss', 'web'];
        const tabStates = this.deps.getTabStates();

        modes.forEach(mode => {
            const turns = tabStates[mode].turns;

            if (turns && turns.length > 0) {
                console.debug('[HistoryService] Rendering', mode, 'turns:', turns.length);

                // Use TurnRenderer directly via event
                this.deps.eventBus.emit('render:restoreTurns', {
                    turns: turns,
                    mode: mode
                });

                Actions.setTurns(this.deps.store, mode, turns);
            }
        });

        this.deps.filterMessagesByMode(true);
    }

    loadHistory(): 'edit' | 'discuss' | 'web' | null {
        const savedTurns = this.deps.plugin.settings.savedTurns;
        const hasTurns = savedTurns !== undefined;

        if (!hasTurns) {
            console.debug('[HistoryService] No saved history found - starting fresh');
            return null;
        }

        const tabStates = this.deps.getTabStates();

        console.debug('[HistoryService] Loading from Turn format');

        if (savedTurns?.edit && Array.isArray(savedTurns.edit)) {
            tabStates.edit.turns = savedTurns.edit;
            Actions.setTurns(this.deps.store, 'edit', tabStates.edit.turns);
        }
        if (savedTurns?.discuss && Array.isArray(savedTurns.discuss)) {
            tabStates.discuss.turns = savedTurns.discuss;
            Actions.setTurns(this.deps.store, 'discuss', tabStates.discuss.turns);
        }
        if (savedTurns?.web && Array.isArray(savedTurns.web)) {
            tabStates.web.turns = savedTurns.web;
            Actions.setTurns(this.deps.store, 'web', tabStates.web.turns);
        }

        const savedEditCounter = this.deps.plugin.settings.editCounter;
        if (savedEditCounter !== undefined) {
            this.deps.setEditCounter(savedEditCounter);
            Actions.setEditCounter(this.deps.store, savedEditCounter);
            Actions.setCurrentEditNumber(this.deps.store, savedEditCounter);
        }

        // Restore edit positions for Apply functionality
        const savedPositions = this.deps.plugin.settings.editPositions;
        console.debug('[HistoryService] savedPositions from settings:', savedPositions);
        console.debug('[HistoryService] editPositionMap size BEFORE restore:', this.deps.getEditPositionMap().size);
        if (savedPositions && Array.isArray(savedPositions)) {
            console.debug('[HistoryService] Restoring', savedPositions.length, 'edit positions');
            savedPositions.forEach(({ editNumber, position }) => {
                console.debug('[HistoryService]   Restoring position for edit', editNumber, ':', position?.text?.substring(0, 50));
                this.deps.setEditPosition(editNumber, position);
            });
        } else {
            console.debug('[HistoryService] No savedPositions to restore (undefined or not array)');
        }
        console.debug('[HistoryService] editPositionMap size AFTER restore:', this.deps.getEditPositionMap().size);

        // Restore edit chains
        const savedChains = this.deps.plugin.settings.editChains;
        console.debug('[HistoryService] savedChains from settings:', savedChains);
        if (savedChains && Array.isArray(savedChains)) {
            console.debug('[HistoryService] Restoring', savedChains.length, 'edit chains');
            savedChains.forEach(({ editNumber, chain }) => {
                this.deps.setEditChain(editNumber, chain);
            });
        } else {
            console.debug('[HistoryService] No savedChains to restore');
        }

        this.rebuildChatUI();
        this.deps.eventBus.emit('render:addWelcomeMessages');
        this.deps.filterMessagesByMode(true);

        const savedTab = this.deps.plugin.settings.lastActiveTab;
        return savedTab ?? null;
    }

    async saveHistory(): Promise<void> {
        const tabStates = this.deps.getTabStates();

        // Capture UI state from DOM before saving
        this.captureUIState();

        // NEW: Save Turn format (always, even if empty)
        this.deps.plugin.settings.savedTurns = {
            edit: tabStates.edit.turns,
            discuss: tabStates.discuss.turns,
            web: tabStates.web.turns
        };
        console.debug('[HistoryService] Saved Turn format:',
            tabStates.edit.turns.length, 'edit,',
            tabStates.discuss.turns.length, 'discuss,',
            tabStates.web.turns.length, 'web turns');

        this.deps.plugin.settings.editCounter = this.deps.getEditCounter();

        // Save edit positions for Apply functionality after restart
        const positionMap = this.deps.getEditPositionMap();
        const positions: { editNumber: number; position: EditPosition }[] = [];
        positionMap.forEach((position, editNumber) => {
            positions.push({ editNumber, position });
        });
        this.deps.plugin.settings.editPositions = positions;
        console.debug('[HistoryService] Saved', positions.length, 'edit positions');

        // Save edit chains for chain-based Apply
        const chainMap = this.deps.getEditChains();
        const chains: { editNumber: number; chain: number[] }[] = [];
        chainMap.forEach((chain, editNumber) => {
            chains.push({ editNumber, chain });
        });
        this.deps.plugin.settings.editChains = chains;
        console.debug('[HistoryService] Saved', chains.length, 'edit chains');

        await this.deps.plugin.saveSettings();
    }

    async clearTab(
        mode: 'edit' | 'discuss' | 'web',
        options?: { resetEditCounter?: boolean; skipSave?: boolean; skipScroll?: boolean }
    ): Promise<void> {
        const tabStates = this.deps.getTabStates();
        tabStates[mode].turns = []; // CLEAR TURNS TOO
        Actions.clearMessages(this.deps.store, mode);

        this.deps.eventBus.emit('history:clear', { tab: mode });
        if (mode === 'edit' && options?.resetEditCounter) {
            this.deps.setEditCounter(0);
            Actions.setEditCounter(this.deps.store, 0);
            Actions.setCurrentEditNumber(this.deps.store, 0);
            // Clear edit positions and chains when clearing edit tab
            this.deps.clearEditPositions();
            this.deps.clearEditChains();
        }

        this.deps.eventBus.emit('render:clearTab', { mode });
        this.deps.filterMessagesByMode(options?.skipScroll);

        if (!options?.skipSave) {
            await this.saveHistory();
        }
    }

    async clearAll(options?: { skipSave?: boolean; skipScroll?: boolean }): Promise<void> {
        const tabStates = this.deps.getTabStates();
        tabStates.edit.turns = []; // CLEAR TURNS TOO
        tabStates.discuss.turns = [];
        tabStates.web.turns = [];
        Actions.clearAllMessages(this.deps.store);

        this.deps.eventBus.emit('history:clear', {});
        this.deps.setEditCounter(0);
        Actions.setEditCounter(this.deps.store, 0);
        Actions.setCurrentEditNumber(this.deps.store, 0);
        // Clear edit positions and chains
        this.deps.clearEditPositions();
        this.deps.clearEditChains();

        this.deps.eventBus.emit('render:clearAllTabs');
        this.deps.filterMessagesByMode(options?.skipScroll);

        if (!options?.skipSave) {
            await this.saveHistory();
        }
    }
}
