/**
 * ConnectionIndicator - shows Ollama connection status
 * Event-Driven component
 */

import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';

export class ConnectionIndicator {
    private llmStatusEl: HTMLElement | null = null;

    constructor(
        private eventBus: EventBus,
        private store: Store
    ) {
        this.eventBus.on('connection:changed', this.handleConnectionChanged.bind(this));
        this.eventBus.on('app:ready', this.initialize.bind(this));
    }

    private initialize(): void {
        this.llmStatusEl = activeDocument.getElementById('llm-status');
        this.updateDisplay();
    }

    private handleConnectionChanged(data: { connected: boolean }): void {
        console.debug('[ConnectionIndicator] Connection changed:', data.connected);
        this.updateDisplay();
    }

    private updateDisplay(): void {
        const state = this.store.getState();
        const isConnected = state.ui.isConnected;

        console.debug('[ConnectionIndicator] Update display, connected:', isConnected);

        if (!this.llmStatusEl) return;
        this.llmStatusEl.empty();
        const dot = this.llmStatusEl.createSpan();
        dot.toggleClass('oa-dot-connected', isConnected);
        dot.toggleClass('oa-dot-disconnected', !isConnected);
        dot.textContent = '●';
        this.llmStatusEl.appendText(isConnected ? ' Connected' : ' Disconnected');
    }

    cleanup(): void {
        // EventBus handles unsubscribe
    }
}
