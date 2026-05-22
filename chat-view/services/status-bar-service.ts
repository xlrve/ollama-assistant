/**
 * StatusBarService - creates and manages the status bar (speed/model/web/LLM).
 */
export class StatusBarService {
    /**
     * Creates the full status bar area:
     * - top row ("11M Status" toggle + "Clear Chat" menu)
     * - panels spoiler container
     *
     * Keeps DOM/classes aligned with the existing UI.
     */
    createStatusBarArea(
        container: HTMLElement,
        supportsTools: boolean,
        updateLLMStatus: (el: HTMLElement) => Promise<void>,
        actions: {
            onClearCurrentTab: () => void;
            onClearAllTabs: () => void;
        }
    ): {
        statusBarWrapper: HTMLElement;
        panels: HTMLElement;
        modelInfo: HTMLElement | null;
        webSearchStatus: HTMLElement | null;
    } {
        // Status bar wrapper with spoiler
        const statusBarWrapper = container.createDiv({ cls: 'status-bar-wrapper' });

        // Top row with buttons (11M Status left, Clear Chat right)
        const statusBarTopRow = statusBarWrapper.createDiv({ cls: 'status-bar-top-row' });

        // Info toggle button (left side)
        const infoToggle = statusBarTopRow.createDiv({ cls: 'info-toggle' });
        infoToggle.createSpan({ cls: 'info-label', text: 'LLM Status' });
        const arrow = infoToggle.createSpan({ cls: 'info-arrow', text: '▼' });

        // Clear chat button (right side)
        const clearChatToggle = statusBarTopRow.createDiv({ cls: 'info-toggle clear-chat-toggle' });
        const clearIconSvg = clearChatToggle.createSpan({ cls: 'clear-chat-icon' });
        const trashSvg = clearIconSvg.createSvg('svg', {
            attr: { xmlns: 'http://www.w3.org/2000/svg', width: '10', height: '10', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
        });
        trashSvg.createSvg('polyline', { attr: { points: '3 6 5 6 21 6' } });
        trashSvg.createSvg('path', { attr: { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' } });
        clearChatToggle.createSpan({ cls: 'info-label', text: 'Clear chat' });

        // Clear chat dropdown menu
        const clearChatMenu = container.createDiv({ cls: 'clear-chat-menu' });
        clearChatMenu.addClass('oa-hidden');

        const clearCurrentBtn = clearChatMenu.createDiv({
            cls: 'menu-item',
            text: 'Clear current tab'
        });
        const clearAllBtn = clearChatMenu.createDiv({
            cls: 'menu-item',
            text: 'Clear all tabs'
        });

        // Toggle clear chat menu
        clearChatToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearChatMenu.classList.toggle('oa-hidden');
        });

        // Clear current tab
        clearCurrentBtn.addEventListener('click', () => {
            actions.onClearCurrentTab();
            clearChatMenu.addClass('oa-hidden');
        });

        // Clear all tabs
        clearAllBtn.addEventListener('click', () => {
            actions.onClearAllTabs();
            clearChatMenu.addClass('oa-hidden');
        });

        // Close menu when clicking outside
        container.ownerDocument.addEventListener('click', (e) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (clearChatMenu.contains(target) || clearChatToggle.contains(target)) return;
            clearChatMenu.addClass('oa-hidden');
        });

        // Status bar (BELOW the top row - info panels spoiler)
        const statusBar = statusBarWrapper.createDiv({ cls: 'ollama-status-bar-new' });
        statusBar.addClass('oa-hidden');

        arrow.textContent = '▼';
        const { panels, modelInfo, webSearchStatus } = this.createPanels(statusBar, supportsTools, updateLLMStatus);

        infoToggle.addEventListener('click', () => {
            const isHidden = panels.hasClass('oa-hidden');
            panels.classList.toggle('oa-hidden');
            statusBar.classList.toggle('oa-hidden');
            arrow.textContent = isHidden ? '▲' : '▼';
        });

        return { statusBarWrapper, panels, modelInfo, webSearchStatus };
    }

    createPanels(
        container: HTMLElement,
        supportsTools: boolean,
        updateLLMStatus: (el: HTMLElement) => Promise<void>
    ): {
        panels: HTMLElement;
        modelInfo: HTMLElement | null;
        webSearchStatus: HTMLElement | null;
    } {
        const panels = container.createDiv({ cls: 'status-panels' });
        panels.addClass('oa-hidden');
        panels.addClass('oa-status-panels');

        const llmPanel = panels.createDiv({ cls: 'status-panel' });
        llmPanel.createSpan({ cls: 'panel-label', text: 'Ollama: ' });
        const llmStatus = llmPanel.createSpan({ cls: 'panel-value' });
        llmStatus.id = 'llm-status';
        void updateLLMStatus(llmStatus);

        const modelPanel = panels.createDiv({ cls: 'status-panel' });
        modelPanel.createSpan({ cls: 'panel-label', text: 'Model: ' });
        const modelInfo = modelPanel.createSpan({ cls: 'panel-value' });
        modelInfo.id = 'model-info';

        const webPanel = panels.createDiv({ cls: 'status-panel' });
        webPanel.createSpan({ cls: 'panel-label', text: 'Web: ' });
        const webSearchStatus = webPanel.createSpan({ cls: 'panel-value' });
        webSearchStatus.id = 'web-search-status';
        webSearchStatus.textContent = supportsTools ? 'Available' : 'Disabled';

        const speedPanel = panels.createDiv({ cls: 'status-panel' });
        speedPanel.createSpan({ cls: 'panel-label', text: 'Speed: ' });
        const speedInfo = speedPanel.createSpan({ cls: 'panel-value' });
        speedInfo.id = 'speed-info';

        return { panels, modelInfo, webSearchStatus };
    }
}
