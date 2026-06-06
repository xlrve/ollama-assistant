/**
 * BufferIndicator - displays bot context buffer usage
 * Event-Driven component showing token usage as percentage
 */

import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';
import { Actions } from '../core/actions';
import type OllamaAssistantPlugin from '../../main';
import { requestUrl } from 'obsidian';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
    return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function getRecord(record: UnknownRecord, key: string): UnknownRecord | undefined {
    return asRecord(record[key]) ?? undefined;
}

function getNumberValue(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

export class BufferIndicator {
    private valueEl: HTMLElement | null = null;
    private tooltipEl: HTMLElement | null = null;
    private tooltipPopupEl: HTMLElement | null = null;
    private ownsTooltipPopup: boolean = false;
    private tooltipMouseEnterHandler: ((e: MouseEvent) => void) | null = null;
    private tooltipMouseLeaveHandler: (() => void) | null = null;
    private cachedContextWindow: number | null = null; // Cache for quick updates
    private waitingForRecalc: boolean = false; // Flag waiting for recalc after context change

    constructor(
        private plugin: OllamaAssistantPlugin,
        private eventBus: EventBus,
        private store: Store
    ) {
        this.eventBus.on('tokens:counted', (data) => this.handleTokensCounted(data));
        this.eventBus.on('mode:switched', (data) => this.handleModeSwitch(data));
        this.eventBus.on('history:clear', (data) => this.handleClear(data));
        this.eventBus.on('model:changed', () => this.handleModelChanged());
        this.eventBus.on('generation:start', (data) => this.handleGenerationStart(data));
        this.eventBus.on('generation:completed', () => this.handleGenerationCompleted());
        this.eventBus.on('generation:stopped', () => this.handleGenerationStopped());
        this.eventBus.on('context:sizeChanged', (data) => this.handleContextSizeChanged(data));
        this.eventBus.on('app:ready', () => this.initialize());
    }

    private initialize(): void {
        const loadStatEl = activeDocument.getElementById('chat-load-stat');
        if (loadStatEl) {
            this.valueEl = loadStatEl.querySelector('.stat-value');
        }
        this.tooltipEl = activeDocument.getElementById('buffer-info');

        // Create tooltip popup (once) and attach hover handlers
        this.ensureTooltipPopup();
        this.attachTooltipHoverHandlers();

        // Load context window at startup
        void this.fetchAndCacheContextWindow().then(() => {
            this.updateDisplay();
        });
    }

    private ensureTooltipPopup(): void {
        const existing = activeDocument.getElementById('buffer-tooltip');
        if (existing) {
            this.tooltipPopupEl = existing;
            this.ownsTooltipPopup = false;
            return;
        }

        this.tooltipPopupEl = activeDocument.body.createDiv({
            cls: 'buffer-tooltip oa-hidden',
            attr: { id: 'buffer-tooltip' }
        });
        this.ownsTooltipPopup = true;
    }

    private attachTooltipHoverHandlers(): void {
        if (!this.tooltipEl || !this.tooltipPopupEl) return;

        // Avoid duplicate handlers when initialize is called again.
        if (this.tooltipMouseEnterHandler) {
            this.tooltipEl.removeEventListener('mouseenter', this.tooltipMouseEnterHandler);
        }
        if (this.tooltipMouseLeaveHandler) {
            this.tooltipEl.removeEventListener('mouseleave', this.tooltipMouseLeaveHandler);
        }

        this.tooltipMouseEnterHandler = (e: MouseEvent) => {
            const icon = e.currentTarget as HTMLElement | null;
            const tooltipText = icon?.getAttribute('data-tooltip');
            if (!icon || !tooltipText || !this.tooltipPopupEl) return;

            this.tooltipPopupEl.textContent = tooltipText;
            this.tooltipPopupEl.removeClass('oa-hidden');

            const rect = icon.getBoundingClientRect();
            const view = icon.ownerDocument.defaultView ?? activeWindow;
            this.tooltipPopupEl.setCssProps({ '--oa-right': (view.innerWidth - rect.left + 5) + 'px', '--oa-left': 'auto', '--oa-top': (rect.bottom + 5) + 'px', '--oa-bottom': 'auto' });
        };
        this.tooltipEl.addEventListener('mouseenter', this.tooltipMouseEnterHandler);

        this.tooltipMouseLeaveHandler = () => {
            if (this.tooltipPopupEl) {
                this.tooltipPopupEl.addClass('oa-hidden');
            }
        };
        this.tooltipEl.addEventListener('mouseleave', this.tooltipMouseLeaveHandler);
    }

    private handleModeSwitch(data: { from: string; to: 'edit' | 'discuss' | 'web' }): void {
        // Instant update when switching tabs
        // IMPORTANT: use data.to from event, not Store, as Store updates AFTER emit
        this.updateDisplayForTab(data.to);
    }

    private handleTokensCounted(data: { tab: string }): void {
        const state = this.store.getState();
        // Update only if this is current tab
        if (state.ui.currentTab !== data.tab) return;

        // Reset waiting flag - now can show real data
        this.waitingForRecalc = false;

        // IMPORTANT: In Web mode tokens:counted emits multiple times (reasoning, system, answer)
        // Keep "Calc" until generation:completed
        const isWebMode = data.tab === 'web';

        if (this.valueEl && !isWebMode) {
            this.valueEl.classList.remove('calculating');
        }

        // CRITICAL: Use tab from event for proper update
        // In Web mode don't update display while generating (keep "Calc")
        if (!isWebMode) {
            this.updateDisplayForTab(data.tab);
        }
    }

    private handleGenerationStart(data: { tab: 'edit' | 'discuss' | 'web' }): void {
        const state = this.store.getState();
        if (state.ui.currentTab !== data.tab) return;

        if (!this.valueEl) return;
        this.valueEl.textContent = 'Calc';
        this.valueEl.classList.add('calculating');
        this.hideTooltip();
    }

    private handleGenerationCompleted(): void {
        if (this.valueEl) {
            this.valueEl.classList.remove('calculating');
        }
        // CRITICAL: Update display after generation completes
        // to show final token value
        this.updateDisplay();
    }

    private handleGenerationStopped(): void {
        if (this.valueEl) {
            this.valueEl.classList.remove('calculating');
        }
        this.updateDisplay();
    }

    private handleClear(data?: { tab?: 'edit' | 'discuss' | 'web' }): void {
        if (!this.valueEl) return;
        const state = this.store.getState();
        if (data?.tab && data.tab !== state.ui.currentTab) return;
        this.updateDisplay();
    }

    private handleModelChanged(): void {
        console.debug('[BufferIndicator] Model changed - clearing cache and resetting all tokens');

        // CRITICAL: Reset tokens for ALL tabs
        // Tokens from old model are no longer valid
        Actions.resetAllTokenMetrics(this.store);

        // Clear cache and show Idle while loading new
        this.cachedContextWindow = null;
        if (this.valueEl) {
            this.valueEl.textContent = 'Idle';
        }
        this.hideTooltip();

        // Load new context window
        void this.fetchAndCacheContextWindow().then(() => {
            console.debug('[BufferIndicator] New context window cached:', this.cachedContextWindow);
            this.updateDisplay();
        });
    }

    private handleContextSizeChanged(data: { newSize: number }): void {
        console.debug('[BufferIndicator] Context size changed in settings:', data.newSize);

        // Invalidate cache - for local models new size will be used
        this.cachedContextWindow = null;

        // Show Idle immediately (only if there's history)
        const state = this.store.getState();
        const currentTab = state.ui.currentTab;
        const tabState = state.tabs[currentTab];

        if (this.valueEl && (tabState.turns?.length || 0) > 0) {
            this.valueEl.textContent = 'Idle';
            this.valueEl.classList.remove('calculating');
            this.hideTooltip();

            // Set waiting flag - DON'T update until bot responds
            this.waitingForRecalc = true;
        }

        // Reload context window (but DON'T call updateDisplay!)
        void this.fetchAndCacheContextWindow().then(() => {
            console.debug('[BufferIndicator] Context window updated to:', this.cachedContextWindow);
            // DON'T call updateDisplay() - wait for next tokens:counted
        });
    }

    /**
     * Load and cache context window
     */
    private async fetchAndCacheContextWindow(): Promise<void> {
        const stats = await this.getModelStats();
        if (stats && stats.context_window) {
            this.cachedContextWindow = stats.context_window;
        }
    }

    /**
     * Update display (SYNCHRONOUSLY using cache)
     */
    private updateDisplay(): void {
        const state = this.store.getState();
        const currentTab = state.ui.currentTab;
        this.updateDisplayForTab(currentTab);
    }

    /**
     * Update display for specific tab
     */
    private updateDisplayForTab(tab: 'edit' | 'discuss' | 'web'): void {
        if (!this.valueEl) return;

        const state = this.store.getState();
        const tabState = state.tabs[tab];

        console.debug('[BufferIndicator] updateDisplayForTab', tab,
                    'turns:', tabState.turns?.length || 0,
                    'prompt:', tabState.lastPromptTokens,
                    'response:', tabState.lastResponseTokens,
                    'isCalculating:', tabState.isCalculating,
                    'waitingForRecalc:', this.waitingForRecalc);

        // CRITICAL: If waiting for recalc after context change - keep Idle
        if (this.waitingForRecalc) {
            this.valueEl.textContent = 'Idle';
            this.valueEl.classList.remove('calculating');
            this.hideTooltip();
            return;
        }

        // CRITICAL: If tab is generating - show "Calc" regardless of tokens
        // This fixes the issue when switching tabs during generation
        if (tabState.isCalculating) {
            this.valueEl.textContent = 'Calc';
            this.valueEl.classList.add('calculating');
            this.hideTooltip();
            return;
        }

        // Idle if no history
        if ((tabState.turns?.length || 0) === 0) {
            this.valueEl.textContent = 'Idle';
            this.valueEl.classList.remove('calculating');
            this.hideTooltip();
            return;
        }

        // Count tokens using real data from Ollama
        const historyTokens = this.calculateHistoryTokens(tab);

        if (historyTokens === 0) {
            this.valueEl.textContent = 'Idle';
            this.valueEl.classList.remove('calculating');
            this.hideTooltip();
            return;
        }

        // Show percentage using cache
        if (this.cachedContextWindow) {
            const percentage = Math.round((historyTokens / this.cachedContextWindow) * 100);
            console.debug('[BufferIndicator] Setting display:', `${percentage}%`, 'tokens:', historyTokens, 'context:', this.cachedContextWindow);
            this.valueEl.textContent = `${percentage}%`;
            this.valueEl.classList.remove('calculating');
            this.showTooltip(historyTokens, this.cachedContextWindow);
        } else {
            // If no cache - show in thousands and load cache
            const tokensK = Math.round(historyTokens / 1000);
            console.debug('[BufferIndicator] Setting display (no cache):', `${tokensK}k`, 'tokens:', historyTokens);
            this.valueEl.textContent = `${tokensK}k`;
            this.valueEl.classList.remove('calculating');
            this.hideTooltip();

            // Load in background
            void this.fetchAndCacheContextWindow().then(() => {
                this.updateDisplay(); // Update again when loaded
            });
        }
    }

    /**
     * Calculate tokens using REAL data from Ollama
     * Ollama provides exact token count including reasoning!
     */
    private calculateHistoryTokens(tab: 'edit' | 'discuss' | 'web'): number {
        const state = this.store.getState();
        const tabState = state.tabs[tab];

        // Use real tokens from Ollama (includes reasoning!)
        const promptTokens = tabState.lastPromptTokens || 0;
        const responseTokens = tabState.lastResponseTokens || 0;

        return promptTokens + responseTokens;
    }

    private async getModelStats(): Promise<{ context_window?: number } | null> {
        try {
            const response = await requestUrl({
                url: `${this.plugin.settings.baseUrl}/api/show`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: this.plugin.settings.model }),
            });

            if (response.status !== 200) return null;

            const responseJson: unknown = response.json;
            const data = asRecord(responseJson);
            if (!data) return null;

            // Check if this is a cloud model
            const modelLower = this.plugin.settings.model.toLowerCase();
            const isCloudModel = modelLower.includes('claude') || modelLower.includes('gpt');

            let contextLength: number | null = null;
            const modelInfo = getRecord(data, 'model_info');

            if (isCloudModel) {
                // For cloud models take maximum context from model
                const architecture = modelInfo?.['general.architecture'];
                contextLength = typeof architecture === 'string'
                    ? getNumberValue(modelInfo?.[`${architecture}.context_length`])
                    : null;

                if (!contextLength) {
                    contextLength = getNumberValue(modelInfo?.['llama.context_length']) ||
                        getNumberValue(modelInfo?.['context_length']) ||
                        getNumberValue(data.context_length);
                }
            } else {
                // For local models use value from plugin settings
                // DON'T use model maximum - it allocates too much VRAM
                contextLength = this.plugin.settings.defaultContextSize;
                console.debug('[BufferIndicator] Using plugin default context:', contextLength);
            }

            if (contextLength) {
                return { context_window: contextLength };
            }
            return null;
        } catch {
            return null;
        }
    }

    private showTooltip(used: number, total: number): void {
        if (!this.tooltipEl) return;

        const usedFormatted = used >= 1000 ? `${Math.round(used / 1000)}k` : used.toString();
        const totalFormatted = total >= 1000 ? `${Math.round(total / 1000)}k` : total.toString();

        this.tooltipEl.setAttribute('data-tooltip', `Used: ${usedFormatted} / ${totalFormatted} tokens`);
        this.tooltipEl.removeClass('oa-hidden');
    }

    private hideTooltip(): void {
        if (!this.tooltipEl) return;
        this.tooltipEl.addClass('oa-hidden');

        if (this.tooltipPopupEl) {
            this.tooltipPopupEl.addClass('oa-hidden');
        }
    }

    cleanup(): void {
        if (this.tooltipEl && this.tooltipMouseEnterHandler) {
            this.tooltipEl.removeEventListener('mouseenter', this.tooltipMouseEnterHandler);
        }
        if (this.tooltipEl && this.tooltipMouseLeaveHandler) {
            this.tooltipEl.removeEventListener('mouseleave', this.tooltipMouseLeaveHandler);
        }

        this.tooltipMouseEnterHandler = null;
        this.tooltipMouseLeaveHandler = null;

        if (this.tooltipPopupEl) {
            this.tooltipPopupEl.addClass('oa-hidden');
            if (this.ownsTooltipPopup) {
                this.tooltipPopupEl.remove();
            }
        }

        this.tooltipPopupEl = null;
        this.tooltipEl = null;
        this.valueEl = null;
        this.ownsTooltipPopup = false;
    }
}
