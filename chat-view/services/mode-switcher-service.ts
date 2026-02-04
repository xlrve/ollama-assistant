/**
 * ModeSwitcherService - creates and manages mode switcher.
 */
export class ModeSwitcherService {
    private containerEl: HTMLElement | null = null;

    updateIndicators(modeSwitcher: HTMLElement, processingTab: 'edit' | 'discuss' | 'web' | null, queuedModes: Set<'edit' | 'discuss' | 'web'>) {
        const buttons = {
            edit: modeSwitcher.querySelector('#mode-edit-btn'),
            discuss: modeSwitcher.querySelector('#mode-discuss-btn'),
            web: modeSwitcher.querySelector('#mode-web-btn')
        };

        // Remove existing dots
        Object.values(buttons).forEach(btn => {
            if (btn) {
                const existingDot = btn.querySelector('.tab-indicator-dot');
                if (existingDot) {
                    existingDot.remove();
                }
            }
        });

        // Add pulsing dot to processing tab
        if (processingTab && buttons[processingTab]) {
            const dot = buttons[processingTab].createEl('span', { cls: 'tab-indicator-dot pulsing' });
            buttons[processingTab].prepend(dot);
        }

        // Add static dots to queued tabs
        queuedModes.forEach(mode => {
            if (mode !== processingTab && buttons[mode]) {
                const dot = buttons[mode].createEl('span', { cls: 'tab-indicator-dot static' });
                buttons[mode].prepend(dot);
            }
        });
    }

    create(modeSwitcherContainer: HTMLElement, supportsTools: boolean, onSwitch: (mode: 'edit' | 'discuss' | 'web') => void) {
        this.containerEl = modeSwitcherContainer;
        const editBtn = modeSwitcherContainer.createEl('button', {
            text: 'Edit',
            cls: 'mode-btn mode-btn-active',
            attr: { id: 'mode-edit-btn' }
        });
        editBtn.addEventListener('click', () => onSwitch('edit'));

        const discussBtn = modeSwitcherContainer.createEl('button', {
            text: 'Discuss',
            cls: 'mode-btn',
            attr: { id: 'mode-discuss-btn' }
        });
        discussBtn.addEventListener('click', () => onSwitch('discuss'));

        if (supportsTools) {
            const webBtn = modeSwitcherContainer.createEl('button', {
                text: 'Web',
                cls: 'mode-btn',
                attr: { id: 'mode-web-btn' }
            });
            webBtn.addEventListener('click', () => onSwitch('web'));
        }
    }
    
    /**
     * Update Web tab visibility when model changes
     */
    update(supportsTools: boolean, onSwitch: (mode: 'edit' | 'discuss' | 'web') => void) {
        const container = this.containerEl;
        if (!container) return;

        const webBtn = container.querySelector('#mode-web-btn');

        if (supportsTools && !webBtn) {
            // Add Web button if it doesn't exist
            const newWebBtn = container.createEl('button', {
                text: 'Web',
                cls: 'mode-btn',
                attr: { id: 'mode-web-btn' }
            });
            newWebBtn.addEventListener('click', () => onSwitch('web'));
        } else if (!supportsTools && webBtn) {
            // Remove Web button if model doesn't support tools
            webBtn.remove();
        }
    }
}

