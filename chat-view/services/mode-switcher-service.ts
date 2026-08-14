/**
 * ModeSwitcherService - creates and manages mode switcher.
 */
type ChatMode = 'edit' | 'discuss' | 'web';

export class ModeSwitcherService {
    private containerEl: HTMLElement | null = null;

    private createModeTab(
        modeSwitcherContainer: HTMLElement,
        mode: ChatMode,
        label: string,
        isActive: boolean,
        onSwitch: (mode: ChatMode) => void
    ): HTMLElement {
        const tab = modeSwitcherContainer.createDiv({
            text: label,
            cls: isActive ? 'mode-btn mode-btn-active' : 'mode-btn',
            attr: {
                id: `mode-${mode}-btn`,
                role: 'tab',
                tabindex: isActive ? '0' : '-1',
                'aria-selected': isActive ? 'true' : 'false'
            }
        });

        tab.addEventListener('click', () => onSwitch(mode));
        tab.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onSwitch(mode);
        });

        return tab;
    }

    updateIndicators(modeSwitcher: HTMLElement, processingTab: ChatMode | null, queuedModes: Set<ChatMode>) {
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
            const dot = buttons[processingTab].createSpan({ cls: 'tab-indicator-dot pulsing' });
            buttons[processingTab].prepend(dot);
        }

        // Add static dots to queued tabs
        queuedModes.forEach(mode => {
            if (mode !== processingTab && buttons[mode]) {
                const dot = buttons[mode].createSpan({ cls: 'tab-indicator-dot static' });
                buttons[mode].prepend(dot);
            }
        });
    }

    create(modeSwitcherContainer: HTMLElement, supportsTools: boolean, onSwitch: (mode: ChatMode) => void) {
        this.containerEl = modeSwitcherContainer;
        modeSwitcherContainer.setAttribute('role', 'tablist');

        this.createModeTab(modeSwitcherContainer, 'edit', 'Edit', true, onSwitch);
        this.createModeTab(modeSwitcherContainer, 'discuss', 'Discuss', false, onSwitch);

        if (supportsTools) {
            this.createModeTab(modeSwitcherContainer, 'web', 'Web', false, onSwitch);
        }
    }
    
    /**
     * Update Web tab visibility when model changes
     */
    update(supportsTools: boolean, onSwitch: (mode: ChatMode) => void) {
        const container = this.containerEl;
        if (!container) return;

        const webBtn = container.querySelector('#mode-web-btn');

        if (supportsTools && !webBtn) {
            // Add Web button if it doesn't exist
            this.createModeTab(container, 'web', 'Web', false, onSwitch);
        } else if (!supportsTools && webBtn) {
            // Remove Web button if model doesn't support tools
            webBtn.remove();
        }
    }
}

