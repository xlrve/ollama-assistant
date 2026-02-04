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
        const statusBarWrapper = container.createEl('div', { cls: 'status-bar-wrapper' });

        // Top row with buttons (11M Status left, Clear Chat right)
        const statusBarTopRow = statusBarWrapper.createEl('div', { cls: 'status-bar-top-row' });

        // Info toggle button (left side)
        const infoToggle = statusBarTopRow.createEl('div', { cls: 'info-toggle' });
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- "LLM" is an acronym
        infoToggle.createEl('span', { cls: 'info-label', text: 'LLM status' });
        const arrow = infoToggle.createEl('span', { cls: 'info-arrow', text: '▼' });

        // Clear chat button (right side)
        const clearChatToggle = statusBarTopRow.createEl('div', { cls: 'info-toggle clear-chat-toggle' });
        const clearIconSvg = clearChatToggle.createEl('span', { cls: 'clear-chat-icon' });
        const trashSvg = clearIconSvg.createSvg('svg', {
            attr: { xmlns: 'http://www.w3.org/2000/svg', width: '10', height: '10', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
        });
        trashSvg.createSvg('polyline', { attr: { points: '3 6 5 6 21 6' } });
        trashSvg.createSvg('path', { attr: { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' } });
        clearChatToggle.createEl('span', { cls: 'info-label', text: 'Clear chat' });

        // Clear chat dropdown menu
        const clearChatMenu = container.createEl('div', { cls: 'clear-chat-menu' });
        clearChatMenu.addClass('oa-hidden');

        const clearCurrentBtn = clearChatMenu.createEl('div', {
            cls: 'menu-item',
            text: 'Clear current tab'
        });
        const clearAllBtn = clearChatMenu.createEl('div', {
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
        const statusBar = statusBarWrapper.createEl('div', { cls: 'ollama-status-bar-new' });
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
        const panels = container.createEl('div', { cls: 'status-panels' });
        panels.addClass('oa-hidden');
        panels.addClass('oa-status-panels');

        const llmPanel = panels.createEl('div', { cls: 'status-panel' });
        llmPanel.createEl('span', { cls: 'panel-label', text: 'Ollama: ' });
        const llmStatus = llmPanel.createEl('span', { cls: 'panel-value' });
        llmStatus.id = 'llm-status';
        void updateLLMStatus(llmStatus);

        const modelPanel = panels.createEl('div', { cls: 'status-panel' });
        modelPanel.createEl('span', { cls: 'panel-label', text: 'Model: ' });
        const modelInfo = modelPanel.createEl('span', { cls: 'panel-value' });
        modelInfo.id = 'model-info';

        const webPanel = panels.createEl('div', { cls: 'status-panel' });
        webPanel.createEl('span', { cls: 'panel-label', text: 'Web: ' });
        const webSearchStatus = webPanel.createEl('span', { cls: 'panel-value' });
        webSearchStatus.id = 'web-search-status';
        webSearchStatus.textContent = supportsTools ? 'Available' : 'Disabled';

        const speedPanel = panels.createEl('div', { cls: 'status-panel' });
        speedPanel.createEl('span', { cls: 'panel-label', text: 'Speed: ' });
        const speedInfo = speedPanel.createEl('span', { cls: 'panel-value' });
        speedInfo.id = 'speed-info';

        return { panels, modelInfo, webSearchStatus };
    }
}
