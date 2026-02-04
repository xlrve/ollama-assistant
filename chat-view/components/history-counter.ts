/**
 * HistoryCounter - displays bot history fill level
 * Event-Driven component: Edit/Web shows "off", Discuss shows "5/20" (current/max)
 */

import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';
import type OllamaAssistantPlugin from '../../main';

export class HistoryCounter {
    private counterEl: HTMLElement | null = null;
    private unsubscribeStore: (() => void) | null = null;

    constructor(
        private plugin: OllamaAssistantPlugin,
        private eventBus: EventBus,
        private store: Store
    ) {
        // Subscribe to events
        this.eventBus.on('mode:switched', this.updateCounter.bind(this));
        this.eventBus.on('history:clear', this.updateCounter.bind(this));
        this.eventBus.on('app:ready', this.initialize.bind(this));

        // Subscribe to Store changes (Bridge syncs history every 100ms)
        this.unsubscribeStore = this.store.subscribe(() => {
            this.updateCounter();
        });
    }

    /**
     * Initialize - find DOM element
     */
    private initialize(): void {
        const historyStatEl = document.getElementById('chat-history-stat');
        if (historyStatEl) {
            // Find .stat-value inside
            this.counterEl = historyStatEl.querySelector('.stat-value');
        }
        this.updateCounter();
    }

    /**
     * Update counter based on current mode
     */
    private updateCounter(): void {
        if (!this.counterEl) return;

        const state = this.store.getState();
        const currentTab = state.ui.currentTab;

        // Edit and Web modes - no history sent to bot
        if (currentTab === 'edit' || currentTab === 'web') {
            this.counterEl.textContent = 'Off';
            return;
        }

        // Discuss mode - show current/max (count turns, not individual messages)
        const tabState = state.tabs.discuss;
        // Each turn contains user + assistant, so count turns for meaningful history display
        const turnsCount = tabState.turns?.length || 0;
        const maxCount = this.plugin.settings.maxHistoryMessages;

        this.counterEl.textContent = `${turnsCount}/${maxCount}`;
    }

    /**
     * Cleanup
     */
    cleanup(): void {
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
            this.unsubscribeStore = null;
        }
    }
}
