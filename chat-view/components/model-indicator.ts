/**
 * ModelIndicator - displays current model in the button
 * Event-Driven component
 */

import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';
import type OllamaAssistantPlugin from '../../main';

export class ModelIndicator {
    private buttonEl: HTMLButtonElement | null = null;
    private modelInfoEl: HTMLElement | null = null;

    constructor(
        private plugin: OllamaAssistantPlugin,
        private eventBus: EventBus,
        private store: Store
    ) {
        this.eventBus.on('model:changed', this.handleModelChanged.bind(this));
        this.eventBus.on('app:ready', this.initialize.bind(this));
    }

    private initialize(): void {
        // Find model button (created in UIBuilder)
        this.buttonEl = activeDocument.querySelector('.model-btn-corner');
        this.modelInfoEl = activeDocument.getElementById('model-info');
        this.updateDisplay();
    }

    private handleModelChanged(data: { model: string }): void {
        console.debug('[ModelIndicator] Model changed:', data.model);
        this.updateDisplay();
    }

    private updateDisplay(): void {
        const currentModel = this.plugin.settings.model;
        console.debug('[ModelIndicator] Update display:', currentModel);

        // Update status panel (if present)
        if (this.modelInfoEl) {
            this.modelInfoEl.textContent = currentModel;
        }

        // Button always shows "Model", not the model name
        // Model name is shown in the status panel and in the menu
    }

    cleanup(): void {
        // EventBus handles unsubscribe
    }
}
