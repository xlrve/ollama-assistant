import { Notice } from 'obsidian';
import type OllamaAssistantPlugin from '../../main';
import type { EventBus } from '../core/event-bus';

interface ModelMenuDeps {
    plugin: OllamaAssistantPlugin;
    eventBus: EventBus;
    refreshConnectionAndTools: () => Promise<void>;
    getModelButtonEl: () => HTMLElement | null;
}

export class ModelMenuService {
    constructor(private deps: ModelMenuDeps) {}

    async toggleModelMenu(existingMenu: HTMLElement | null): Promise<void> {
        if (existingMenu) {
            existingMenu.remove();
            return;
        }

        const modelButtonEl = this.deps.getModelButtonEl();
        const doc = modelButtonEl?.ownerDocument;
        const bodyEl = doc?.body;
        if (!doc || !bodyEl) return;

        const menu = bodyEl.createEl('div', { cls: 'model-selector-menu' });

        let models: string[] = [];
        try {
            models = await this.deps.plugin.ollamaClient.listModels();
        } catch {
            models = [this.deps.plugin.settings.model];
        }

        const currentModel = this.deps.plugin.settings.model;

        models.forEach((model: string) => {
            const item = menu.createEl('div', {
                cls: 'menu-item' + (model === currentModel ? ' selected' : ''),
                text: model
            });
            item.addEventListener('click', () => {
                void (async () => {
                    this.deps.plugin.settings.model = model;
                    await this.deps.plugin.saveSettings();
                    this.deps.plugin.ollamaClient.updateSettings(this.deps.plugin.settings);
                    menu.remove();

                    this.deps.eventBus.emit('model:changed', { model });

                    await this.deps.refreshConnectionAndTools();

                    new Notice(`Model changed to ${model}`);
                })();
            });
        });

        if (modelButtonEl) {
            const rect = modelButtonEl.getBoundingClientRect();
            menu.setCssProps({ '--oa-left': rect.left + 'px', '--oa-bottom': (window.innerHeight - rect.top) + 'px' });
        }

        setTimeout(() => {
            doc.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target as Node)) {
                    menu.remove();
                    doc.removeEventListener('click', closeMenu);
                }
            });
        }, 0);
    }
}
