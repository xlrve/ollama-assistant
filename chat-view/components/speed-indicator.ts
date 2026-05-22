/**
 * SpeedIndicator - displays generation speed
 * Event-Driven component that listens to generation events and shows tokens/second
 */

import type { EventBus } from '../core/event-bus';

export class SpeedIndicator {
    private speedEl: HTMLElement | null = null;
    private loadingIconEl: HTMLElement | null = null;
    private isGenerating: boolean = false;
    private realSpeed: number = 0; // Real speed from Ollama
    private hasReceivedFirstResponse: boolean = false; // Track if we ever got a response
    private lastDisplayedSpeed: string = ''; // Remember last speed to show during loading
    // Fallback for cloud models (no metrics)
    private startTimestamp: number = 0;
    private totalTokens: number = 0;

    constructor(private eventBus: EventBus) {
        // Subscribe to events
        this.eventBus.on('generation:start', this.handleStart.bind(this));
        this.eventBus.on('generation:chunk', this.handleChunk.bind(this));
        this.eventBus.on('tokens:counted', this.handleTokensCounted.bind(this));
        this.eventBus.on('generation:completed', this.handleCompleted.bind(this));
        this.eventBus.on('generation:stopped', this.handleStopped.bind(this));
        this.eventBus.on('app:ready', this.initialize.bind(this));

        // Reset speed when model changes
        this.eventBus.on('model:changed', this.handleModelChanged.bind(this));
    }

    /**
     * Initialize - find DOM element and create loading icon
     */
    private initialize(): void {
        this.speedEl = activeDocument.getElementById('speed-info');

        // Create loading icon element (hidden by default)
        if (this.speedEl && this.speedEl.parentElement) {
            this.loadingIconEl = this.speedEl.parentElement.createSpan({
                cls: 'speed-spinner oa-hidden'
            });
        }

        this.updateDisplay('Waiting');
    }

    /**
     * Handle generation start
     */
    private handleStart(): void {
        this.isGenerating = true;
        this.realSpeed = 0;
        this.startTimestamp = Date.now();
        this.totalTokens = 0;

        // Show loading state based on whether we've received responses before
        if (!this.hasReceivedFirstResponse) {
            // First request ever or after model change - show "Waiting"
            this.updateDisplay('Waiting');
            this.hideLoadingIcon();
        } else {
            // We have previous speed - show it with loading icon
            this.updateDisplay(this.lastDisplayedSpeed);
            this.showLoadingIcon();
        }
    }

    /**
     * Handle chunk - count tokens for fallback (cloud models)
     */
    private handleChunk(data: { tab: string; content: string; isThinking?: boolean }): void {
        // Count all tokens as fallback
        const tokens = Math.ceil(data.content.length / 4);
        this.totalTokens += tokens;
    }

    /**
     * Handle tokens counted from Ollama - use REAL speed!
     */
    private handleTokensCounted(data: { tab: string; promptTokens: number; responseTokens: number; speed: number }): void {
        // Save real speed from Ollama (local models only)
        this.realSpeed = data.speed;

        // Show speed immediately when we get it from Ollama
        if (this.realSpeed > 0) {
            const speedText = `${this.realSpeed.toFixed(1)}t/s`;
            this.updateDisplay(speedText);
            this.lastDisplayedSpeed = speedText; // Remember for next request
            this.hasReceivedFirstResponse = true; // Mark that we got at least one response
            this.hideLoadingIcon(); // Hide loading icon
            this.isGenerating = false; // Mark as done
        }
    }

    /**
     * Handle completion - calculate fallback speed if no real data
     */
    private handleCompleted(): void {
        if (!this.isGenerating) return;

        // If we got real speed from Ollama - already shown
        if (this.realSpeed > 0) {
            this.isGenerating = false;
            return;
        }

        // Fallback: calculate from chunks (cloud models)
        const endTimestamp = Date.now();
        const elapsedSeconds = (endTimestamp - this.startTimestamp) / 1000;

        if (elapsedSeconds > 0 && this.totalTokens > 0) {
            const averageSpeed = this.totalTokens / elapsedSeconds;
            const speedText = `${averageSpeed.toFixed(1)}t/s`;
            this.updateDisplay(speedText);
            this.lastDisplayedSpeed = speedText; // Remember for next request
            this.hasReceivedFirstResponse = true; // Mark that we got at least one response
        } else {
            this.updateDisplay('Waiting');
        }

        this.hideLoadingIcon(); // Always hide loading icon when done
        this.isGenerating = false;
    }

    /**
     * Handle stopped - same as completed
     */
    private handleStopped(): void {
        this.handleCompleted();
    }

    /**
     * Handle model changed - reset speed
     */
    private handleModelChanged(): void {
        this.updateDisplay('Waiting');
        this.hideLoadingIcon();
        this.isGenerating = false;
        this.realSpeed = 0;
        this.totalTokens = 0;
        this.hasReceivedFirstResponse = false; // Reset on model change
        this.lastDisplayedSpeed = '';
    }

    /**
     * Update DOM element
     */
    private updateDisplay(text: string): void {
        if (!this.speedEl) return;
        this.speedEl.textContent = text;
    }

    /**
     * Show loading icon
     */
    private showLoadingIcon(): void {
        if (!this.loadingIconEl) return;
        this.loadingIconEl.removeClass('oa-hidden');
    }

    /**
     * Hide loading icon
     */
    private hideLoadingIcon(): void {
        if (!this.loadingIconEl) return;
        this.loadingIconEl.addClass('oa-hidden');
    }

    /**
     * Cleanup
     */
    cleanup(): void {
        // Nothing to cleanup (EventBus handles unsubscribe)
    }
}
