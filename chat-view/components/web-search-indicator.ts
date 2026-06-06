/**
 * WebSearchIndicator - shows Web Search mode availability
 * Event-Driven component. Displays "Enabled" (green dot) or "Disabled" (red dot)
 * depending on current model's tool calling support.
 */

import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';

export class WebSearchIndicator {
    private statusEl: HTMLElement | null = null;
    private lastSupportsTools: boolean = false;
    private lastConnected: boolean = false;
    private unsubscribeStore: (() => void) | null = null;

    constructor(
        private eventBus: EventBus,
        private store: Store
    ) {
        this.eventBus.on('model:changed', (data) => this.handleModelChanged(data));
        this.eventBus.on('connection:changed', (data) => this.handleConnectionChanged(data));
        this.eventBus.on('app:ready', () => this.initialize());

        // Subscribe to Store - update only when relevant values change
        this.unsubscribeStore = this.store.subscribe(() => {
            const state = this.store.getState();
            const supportsTools = state.ui.currentModelSupportsTools;
            const isConnected = state.ui.isConnected;

            if (supportsTools !== this.lastSupportsTools || isConnected !== this.lastConnected) {
                this.lastSupportsTools = supportsTools;
                this.lastConnected = isConnected;
                this.updateDisplay();
            }
        });
    }

    private initialize(): void {
        this.statusEl = activeDocument.getElementById('web-search-status');
        this.updateDisplay();
    }

    private handleModelChanged(data: { model: string }): void {
        console.debug('[WebSearchIndicator] Model changed:', data.model);
        // Give time for Store to update with tool support info
        window.setTimeout(() => this.updateDisplay(), 100);
    }

    private handleConnectionChanged(data: { connected: boolean }): void {
        console.debug('[WebSearchIndicator] Connection changed:', data.connected);
        this.updateDisplay();
    }

    private updateDisplay(): void {
        if (!this.statusEl) return;

        const state = this.store.getState();
        const supportsTools = state.ui.currentModelSupportsTools;
        const isConnected = state.ui.isConnected;

        console.debug('[WebSearchIndicator] Update display - connected:', isConnected, 'supports tools:', supportsTools);

        // Show Enabled only if connected AND model supports tools
        const isEnabled = isConnected && supportsTools;

        this.statusEl.empty();
        const dot = this.statusEl.createSpan();
        dot.toggleClass('oa-dot-connected', isEnabled);
        dot.toggleClass('oa-dot-disconnected', !isEnabled);
        dot.textContent = '●';
        this.statusEl.appendText(isEnabled ? ' Enabled' : ' Disabled');
        this.statusEl.className = isEnabled ? 'web-search-available' : 'web-search-unavailable';
    }

    cleanup(): void {
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
            this.unsubscribeStore = null;
        }
    }
}
