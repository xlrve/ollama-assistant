import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, Menu, Editor, MarkdownView, addIcon } from 'obsidian';
import { OllamaClient } from './ollama-client';
import { OllamaChatView, CHAT_VIEW_TYPE } from './chat-view';
import { WebSearchClient } from './web-search';
import { LocalStorageSettings } from './local-storage-settings';
import type { Turn } from './chat-view/types';
import type { EditPosition } from './chat-view/state/types';

// Device-specific settings (stored in localStorage, NOT synced)
interface DeviceSettings {
    baseUrl: string;
    model: string;
    temperature: number;
    maxHistoryMessages: number;
    defaultContextSize: number;
    forceEnableWebMode: boolean;
}

// Serializable edit position (for JSON storage)
interface SerializedEditPosition {
    editNumber: number;
    position: EditPosition;
}

// Serializable edit chain (for JSON storage)
interface SerializedEditChain {
    editNumber: number;
    chain: number[];
}

// Synced settings (stored in data.json, synced between devices)
interface SyncedSettings {
    savedTurns?: {
        edit: Turn[];
        discuss: Turn[];
        web: Turn[];
    };
    lastActiveTab: 'edit' | 'discuss' | 'web';
    editCounter: number;
    // Edit positions and chains for Apply functionality after restart
    editPositions?: SerializedEditPosition[];
    editChains?: SerializedEditChain[];
}

// Combined settings interface (for compatibility with existing code)
interface OllamaAssistantSettings extends DeviceSettings, SyncedSettings {}

// Defaults for device-specific settings
const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
    baseUrl: 'http://localhost:11434',
    model: '', // Will be auto-detected on first load
    temperature: 0.7,
    maxHistoryMessages: 20,
    defaultContextSize: 4096,
    forceEnableWebMode: false,
}

// Defaults for synced settings
const DEFAULT_SYNCED_SETTINGS: SyncedSettings = {
    lastActiveTab: 'edit',
    editCounter: 0
}

export default class OllamaAssistantPlugin extends Plugin {
    settings: OllamaAssistantSettings;
    ollamaClient: OllamaClient;
    webSearchClient: WebSearchClient;
    localSettings: LocalStorageSettings;

    async onload() {
        this.localSettings = new LocalStorageSettings(this.app);
        await this.loadSettings();

        this.ollamaClient = new OllamaClient(this.settings);
        this.webSearchClient = new WebSearchClient();

        // Register custom icon (Obsidian will apply theme color automatically)
        const ollamaIconSvg = `<svg viewBox="0 0 415.88 498.44" xmlns="http://www.w3.org/2000/svg">
            <path fill="currentColor" d="m79.21,497.88c-3.69-.16-7.24-1.5-10.11-3.83-22.87-18.58-42.03-81.47-40.17-107.44.25-3.44,1.52-6.73,3.66-9.43,5.73-7.26,3.92-18.77.24-36.86-2.56-12.61-5.46-26.9-3.95-41.27.09-.88.25-1.75.48-2.6,2.2-8.29,2.34-12.25,2.24-13.8-.83-.54-2.1-1.25-3.11-1.82-7.54-4.25-20.15-11.35-27.44-31.43-.65-1.78-1-3.66-1.03-5.55-.63-34.9,19.44-45.79,28.1-48.85,18.5-6.54,41.97.29,59.68,16.36,23.37-8.23,50.5-6.26,76.87-4.35,49.58,3.59,78.39,3.86,89.51-32.5,9.04-76.15,10.83-90.33,35.91-154.22.15-.38.31-.75.48-1.12,3.4-7.13,10.4-12.26,21.4-15.66,5.9-1.82,12.21-2.92,15.58-3.16,8.28-.6,23.69-1.71,32.8,9.51,5.77,7.12,6.38,15.88,5.04,24.89,24.71,8.84,49.1,31.17,50.43,54.46.6,10.39-2.79,35.11-46.99,40.37-.04,0-.08,0-.12.01-.14,8.71,2.24,24.19,3.65,33.37,1.95,12.71,3.79,24.71,3.8,34.85.08,76.66-17.57,103.55-34.65,129.56-9.81,14.94-19.07,29.05-24.69,54.82-.25,1.15-.62,2.28-1.10,3.35-2.26,7.73-1.36,38.61.31,53.86,3.04,1.92,6.28,4.58,9.68,8.22,11.22,11.99,15.01,24.7,10.64,34.81-2.12,6.63-8.46,14.6-26.43,15.68-7.3.44-15.7-.05-23.10-.49-3.40-.20-7.92-.47-9.95-.43-6.09,1.44-12.60-.56-16.84-5.39-17.03-19.40-30.66-55.47-42.53-112.87-15.90,2.07-40.81,3.79-67.13-.21-7.98,11.01-16.04,21.11-32.07,33.08-1.84,14.56,5.42,25.86,14.98,38.76,6.85,9.25,15.38,20.76,8.52,33.69-5.96,11.23-18.41,14.18-41.22,14.18-6.31,0-13.41-.23-21.38-.56Zm200.84-1.76s.02,0,.02-.01c0,0-.02,0-.02.01Zm23.03-21.55h0s0,0,0,0Zm-216.82-77.28c1.06-3.91,3.47-7.32,6.79-9.62,17.22-11.94,23.24-20.33,32.35-33.04,1.12-1.56,2.27-3.17,3.48-4.83,4-5.51,10.87-8.14,17.52-6.70,39.79,8.58,80.47-.51,80.88-.6h0c4.55-1.05,9.33-.20,13.25,2.36,3.92,2.56,6.62,6.61,7.49,11.21,11.78,62.57,23.93,92.56,33.21,106.87,1.93.08,4.06.20,6.45.34-1.04-1.29-1.90-2.73-2.53-4.29-3.58-8.74-4.66-32.22-4.96-41.91-.88-28.74,1.68-39.33,3.45-43.88,7.02-30.95,18.77-48.84,29.16-64.67,14.96-22.78,29.08-44.29,29.01-110.66,0-7.54-1.73-18.80-3.40-29.68-4.46-29.08-8.31-54.19,6.49-67.23,3.62-3.19,11.12-7.84,22.65-5.86,9.11-1.39,12.75-3.59,13.89-4.47-.37-1.51-1.97-5.24-6.91-10.23-8.58-8.66-21.49-15.22-30.03-15.26-5.38-.02-10.45-2.57-13.68-6.87-3.23-4.31-4.25-9.88-2.76-15.06,1.03-3.58,1.78-6.40,2.31-8.61-.09,0-.19.01-.28.02-2.17.19-6.75,1.23-9.57,2.26-22.10,56.63-23.43,67.81-32.36,143.14-.11.92-.29,1.84-.55,2.73-8.49,29.50-26.70,48.33-54.11,55.95-22.11,6.15-47.11,4.34-71.29,2.58-27.39-1.99-53.26-3.86-70.07,5.69-7.42,4.22-16.81,2.35-22.05-4.38-9.82-12.62-24.39-17.36-30.50-15.20-3.98,1.41-4.97,8.15-5.17,12.90,2.72,5.97,5.96,7.79,10.95,10.60,5.50,3.10,13.82,7.79,18.04,18.19,3.55,8.74,3.42,19.49-.46,34.72-.67,8.85,1.39,18.98,3.56,29.68,3.89,19.17,8.26,40.67-3.29,59.73.47,8.28,3.28,22.51,9.13,39,5.58,15.76,11.34,26.24,15.27,31.60,5.18.16,9.47.23,13,.22-10.07-14.52-22.37-37.24-14.37-66.74Zm229.21-11.18s0,0,0-.01c0,0,0,0,0,.01Z"/>
        </svg>`;
        addIcon('ollama-assistant', ollamaIconSvg);

        // Register chat view
        this.registerView(
            CHAT_VIEW_TYPE,
            (leaf) => new OllamaChatView(leaf, this)
        );

        // Add ribbon icon to open chat
        this.addRibbonIcon('ollama-assistant', 'Open Ollama Assistant', () => {
            void this.activateView();
        });

        // Command to open chat
        this.addCommand({
            id: 'open-chat',
            name: 'Open AI chat',
            callback: () => {
                void this.activateView();
            }
        });

        // Command to add selected text to context (user can assign hotkey in Settings в†’ Hotkeys)
        this.addCommand({
            id: 'add-selection-to-context',
            name: 'Add selected text to context',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                const selection = editor.getSelection();
                if (!selection) return;
                const from = editor.getCursor('from');
                const to = editor.getCursor('to');
                const startOffset = editor.posToOffset(from);
                const endOffset = editor.posToOffset(to);

                await this.activateView();
                const chatView = this.getChatView();
                if (chatView) {
                    chatView.setSelectedTextWithOffsets(selection, startOffset, endOffset);
                }
            }
        });

        // Context menu for selected text
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
                const selection = editor.getSelection();
                if (selection) {
                    const from = editor.getCursor('from');
                    const to = editor.getCursor('to');
                    const startOffset = editor.posToOffset(from);
                    const endOffset = editor.posToOffset(to);

                    menu.addItem((item) => {
                        item
                            .setTitle('Add to tab context')
                            .setIcon('ollama-assistant')
                            .onClick(async () => {
                                await this.activateView();
                                const chatView = this.getChatView();
                                if (chatView) {
                                    chatView.setSelectedTextWithOffsets(selection, startOffset, endOffset);
                                }
                            });
                    });
                }
            })
        );

        // Settings tab
        this.addSettingTab(new OllamaAssistantSettingTab(this.app, this));
    }

    getChatView(): OllamaChatView | null {
        const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
        if (leaves.length > 0) {
            return leaves[0].view as OllamaChatView;
        }
        return null;
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

        if (leaves.length > 0) {
            // View already exists, just reveal it
            leaf = leaves[0];
        } else {
            // Create new view in right sidebar
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                await rightLeaf.setViewState({
                    type: CHAT_VIEW_TYPE,
                    active: true,
                });
                leaf = rightLeaf;
            }
        }

        if (leaf) {
            void workspace.revealLeaf(leaf);
        }
    }

    onunload() {
        // Leaves are not detached here вЂ” Obsidian preserves their position across plugin reloads
    }

    async loadSettings() {
        // Load synced settings from data.json
        const savedData = await this.loadData();
        const syncedSettings: SyncedSettings = Object.assign({}, DEFAULT_SYNCED_SETTINGS, savedData);

        // Load device-specific settings from localStorage
        const deviceSettings: DeviceSettings = {
            baseUrl: this.localSettings.getBaseUrl() ?? DEFAULT_DEVICE_SETTINGS.baseUrl,
            model: this.localSettings.getModel() ?? DEFAULT_DEVICE_SETTINGS.model,
            temperature: this.localSettings.getTemperature() ?? DEFAULT_DEVICE_SETTINGS.temperature,
            maxHistoryMessages: this.localSettings.getMaxHistoryMessages() ?? DEFAULT_DEVICE_SETTINGS.maxHistoryMessages,
            defaultContextSize: this.localSettings.getDefaultContextSize() ?? DEFAULT_DEVICE_SETTINGS.defaultContextSize,
            forceEnableWebMode: this.localSettings.getForceEnableWebMode() ?? DEFAULT_DEVICE_SETTINGS.forceEnableWebMode,
        };

        // Combine into single settings object
        this.settings = { ...syncedSettings, ...deviceSettings };

        // Auto-detect first available model if not set
        if (!this.settings.model || this.settings.model === '') {
            try {
                // Need temporary client to check models
                const tempClient = new OllamaClient({
                    baseUrl: this.settings.baseUrl,
                    model: '',
                    temperature: this.settings.temperature
                });
                const models = await tempClient.listModels();
                if (models.length > 0) {
                    this.settings.model = models[0];
                    this.localSettings.setModel(models[0]);
                }
            } catch (error) {
                // Connection failed, model will remain empty - banner will handle it
                console.debug('Could not auto-detect model:', error);
            }
        }
    }

    async saveSettings() {
        // Save synced settings to data.json
        const syncedSettings: SyncedSettings = {
            savedTurns: this.settings.savedTurns,
            lastActiveTab: this.settings.lastActiveTab,
            editCounter: this.settings.editCounter,
            editPositions: this.settings.editPositions,
            editChains: this.settings.editChains,
        };
        await this.saveData(syncedSettings);

        // Save device-specific settings to localStorage
        this.localSettings.setBaseUrl(this.settings.baseUrl);
        this.localSettings.setModel(this.settings.model);
        this.localSettings.setTemperature(this.settings.temperature);
        this.localSettings.setMaxHistoryMessages(this.settings.maxHistoryMessages);
        this.localSettings.setDefaultContextSize(this.settings.defaultContextSize);
        this.localSettings.setForceEnableWebMode(this.settings.forceEnableWebMode);

        // Update client
        this.ollamaClient.updateSettings(this.settings);
    }

}

class OllamaAssistantSettingTab extends PluginSettingTab {
    plugin: OllamaAssistantPlugin;

    constructor(app: App, plugin: OllamaAssistantPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        // Header with Lottie animation and title
        const headerEl = containerEl.createEl('div', { cls: 'settings-header oa-settings-header' });

        // Lottie animation container - slightly reduced, aligned to bottom, pushed left
        const animationContainer = headerEl.createEl('div', { cls: 'lottie-animation oa-settings-lottie' });
        
        void this.loadLottieAnimation(animationContainer);

        // Title only (no subtitle here)
        headerEl.createEl('div', { cls: 'settings-title oa-settings-title', text: 'Ollama Assistant' });

        // Settings
        const firstSetting = new Setting(containerEl);
        firstSetting.settingEl.addClass('first-setting');

        // Model dropdown with auto-load
        const modelSetting = firstSetting
            .setName('Model')
            .setDesc('Select a model for communication');

        modelSetting.addDropdown(async (dropdown) => {
            // Try to load models
            try {
                const models = await this.plugin.ollamaClient.listModels();

                if (models.length > 0) {
                    models.forEach(model => {
                        dropdown.addOption(model, model);
                    });
                } else {
                    dropdown.addOption(this.plugin.settings.model, this.plugin.settings.model);
                }
            } catch {
                // If can't load models, add current model
                dropdown.addOption(this.plugin.settings.model, this.plugin.settings.model);
            }

            dropdown.setValue(this.plugin.settings.model);
            dropdown.onChange(async (value) => {
                this.plugin.settings.model = value;
                await this.plugin.saveSettings();
                this.plugin.ollamaClient.updateSettings(this.plugin.settings);
            });
        });

        // Add refresh button
        modelSetting.addButton(button => button
            .setButtonText('Refresh')
            .setTooltip('Reload available models')
            .onClick(() => {
                // Refresh the entire settings display to reload dropdown
                this.display();
                new Notice('Models list refreshed');
            }));

        // Response style buttons (temperature presets)
        const responseStyleSetting = new Setting(containerEl)
            .setName('Response style')
            .setDesc('Controls model temperature');

        const stylePresets = [
            { value: 0.3, label: 'Precise' },
            { value: 0.7, label: 'Balanced' },
            { value: 1.0, label: 'Creative' }
        ];

        const styleButtonsContainer = responseStyleSetting.controlEl.createDiv({ cls: 'style-buttons oa-style-buttons' });

        const updateStyleButtons = () => {
            const temp = this.plugin.settings.temperature;
            let activeValue = 0.7;
            if (temp <= 0.5) activeValue = 0.3;
            else if (temp <= 0.85) activeValue = 0.7;
            else activeValue = 1.0;

            styleButtonsContainer.querySelectorAll('button').forEach(btn => {
                const btnValue = parseFloat(btn.getAttribute('data-value') || '0.7');
                btn.toggleClass('mod-cta', btnValue === activeValue);
            });
        };

        stylePresets.forEach(preset => {
            const btn = styleButtonsContainer.createEl('button', { text: preset.label });
            btn.setAttribute('data-value', preset.value.toString());
            btn.addEventListener('click', () => {
                void (async () => {
                    this.plugin.settings.temperature = preset.value;
                    await this.plugin.saveSettings();
                    updateStyleButtons();
                })();
            });
        });

        updateStyleButtons();

        // Context size buttons
        const contextSizes = [4096, 8192, 16384, 32768, 65536, 131072, 262144];
        const contextLabels = ['4k', '8k', '16k', '32k', '64k', '128k', '256k'];

        new Setting(containerEl)
            .setName('Buffer size')
            .setDesc('You can change the context size that the model can handle (may not apply to all models)')
            .addDropdown(dropdown => {
                contextSizes.forEach((size, index) => {
                    dropdown.addOption(size.toString(), contextLabels[index]);
                });
                dropdown.setValue(this.plugin.settings.defaultContextSize.toString());
                dropdown.onChange(async (value) => {
                    const newSize = parseInt(value);
                    this.plugin.settings.defaultContextSize = newSize;
                    await this.plugin.saveSettings();

                    // Notify BufferIndicator to invalidate cache
                    const chatView = this.plugin.getChatView();
                    if (chatView && chatView.eventBus) {
                        chatView.eventBus.emit('context:sizeChanged', { newSize: newSize });
                    }
                });
            });

        new Setting(containerEl)
            .setName('Discuss mode history limit')
            .setDesc('Maximum number of messages to keep in conversation history in discuss mode')
            .addSlider(slider => slider
                .setLimits(2, 100, 2)
                .setValue(this.plugin.settings.maxHistoryMessages)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxHistoryMessages = value;
                    await this.plugin.saveSettings();
                }));

        // Advanced settings collapsible section
        const advancedEl = containerEl.createEl('details', { cls: 'oa-advanced-section' });
        advancedEl.createEl('summary', { cls: 'oa-advanced-summary', text: 'Advanced settings' });

        new Setting(advancedEl)
            .setName('Ollama API URL')
            .setDesc('Base address used for assistant requests')
            .addText(text => text
                .setPlaceholder('http://localhost:11434')
                .setValue(this.plugin.settings.baseUrl)
                .onChange(async (value) => {
                    this.plugin.settings.baseUrl = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Test')
                .setTooltip('Check connection')
                .onClick(async () => {
                    const isConnected = await this.plugin.ollamaClient.checkConnection();
                    if (isConnected) {
                        new Notice('Connected.');
                        const models = await this.plugin.ollamaClient.listModels();
                        if (models.length > 0) {
                            new Notice(`Found ${models.length} models`);
                        }
                    } else {
                        new Notice('Failed to connect. Check the endpoint and ensure the service is running.');
                    }
                }));

        new Setting(advancedEl)
            .setName('Force enable web mode')
            .setDesc('Web search support is automatically detected for each model, but you can manually enable it if needed. Reopen chat or switch model to apply changes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.forceEnableWebMode)
                .onChange(async (value) => {
                    this.plugin.settings.forceEnableWebMode = value;
                    await this.plugin.saveSettings();
                }));

        // Reset to defaults button (below Advanced settings)
        const resetButtonContainer = containerEl.createEl('div', { cls: 'reset-button-container oa-reset-container' });

        const resetButton = resetButtonContainer.createEl('button', { cls: 'mod-cta', text: 'Reset to defaults' });
        resetButton.addEventListener('click', () => {
            void (async () => {
                // Auto-detect first available model
                let defaultModel = '';
                try {
                    const models = await this.plugin.ollamaClient.listModels();
                    defaultModel = models.length > 0 ? models[0] : '';
                } catch {
                    defaultModel = '';
                }

                // Reset device-specific settings in localStorage
                this.plugin.localSettings.resetAll();

                // Reset to defaults with auto-detected model
                this.plugin.settings = {
                    ...DEFAULT_SYNCED_SETTINGS,
                    ...DEFAULT_DEVICE_SETTINGS,
                    model: defaultModel
                };
                await this.plugin.saveSettings();
                this.display(); // Refresh settings UI
                new Notice('Settings reset to defaults');
            })();
        });
    }

    private async loadLottieAnimation(container: HTMLElement) {
        try {
            // Load lottie-web from CDN
            if (!window.lottie) {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            // Embedded lama-success animation data
            const animationData = {"nm":"Comp 4","ddd":0,"h":500,"w":500,"meta":{"g":"@lottiefiles/toolkit-js 0.68.0"},"layers":[{"ty":4,"nm":"ollama-new32 copy Outlines","sr":1,"st":0,"op":750,"ip":0,"ln":"164","hasMask":false,"ao":0,"ks":{"a":{"a":1,"k":[{"o":{"x":0.167,"y":0.167},"i":{"x":0.833,"y":0.833},"s":[185.679,290.954,0],"t":0},{"o":{"x":0.167,"y":0.167},"i":{"x":0.833,"y":0.833},"s":[185.679,290.954,0],"t":5},{"s":[185.679,290.954,0],"t":10}]},"s":{"a":0,"k":[40,40,100]},"p":{"a":1,"k":[{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,416.282,0],"t":0,"ti":[0,0,0],"to":[0,-17,0]},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,314.282,0],"t":3.863},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,416.282,0],"t":7.727},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,314.282,0],"t":12,"ti":[0,-17,0],"to":[0,0,0]},{"o":{"x":0.333,"y":0.333},"i":{"x":0.667,"y":0.667},"s":[241.071,416.282,0],"t":16},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,416.282,0],"t":20,"ti":[0,0,0],"to":[0,-29.333,0]},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,240.282,0],"t":23,"ti":[0,-29.333,0],"to":[0,0,0]},{"s":[241.071,416.282,0],"t":31,"ti":[0,17,0],"to":[0,29.333,0]}]},"r":{"a":1,"k":[{"o":{"x":0.167,"y":0.167},"i":{"x":0.833,"y":0.833},"s":[0],"t":20},{"s":[360],"t":30}]},"sa":{"a":0,"k":0},"o":{"a":0,"k":100}},"shapes":[{"ty":"gr","nm":"Group 1","it":[{"ty":"sh","nm":"Path 1","d":1,"ks":{"a":0,"k":{"c":true,"i":[[0,0],[0,0]],"o":[[0,0],[0,0]],"v":[[107.53,136.89],[107.53,136.88]]}}},{"ty":"sh","nm":"Path 2","d":1,"ks":{"a":0,"k":{"c":true,"i":[[0,0],[-3.32,2.3],[-9.11,12.71],[-1.21,1.66],[-6.65,-1.44],[-0.41,0.09],[-3.92,-2.56],[-0.87,-4.6],[-9.28,-14.31],[-2.39,-0.14],[0.63,1.56],[0.3,9.69],[-1.77,4.55],[-10.39,15.83],[0.07,66.37],[1.67,10.88],[-14.8,13.04],[-11.53,-1.98],[-1.14,0.88],[4.94,4.99],[8.54,0.04],[3.23,4.3],[-1.49,5.18],[-0.53,2.21],[0.09,-0.01],[2.82,-1.03],[8.93,-75.33],[0.26,-0.89],[27.41,-7.62],[24.18,1.76],[16.81,-9.55],[5.24,6.73],[6.11,-2.16],[0.2,-4.75],[-4.99,-2.81],[-4.22,-10.4],[3.88,-15.23],[-2.17,-10.7],[11.55,-19.06],[-5.85,-16.49],[-3.93,-5.36],[-3.53,0.01],[-8,29.5]],"o":[[1.06,-3.91],[17.22,-11.94],[1.12,-1.56],[4,-5.51],[39.79,8.58],[4.55,-1.05],[3.92,2.56],[11.78,62.57],[1.93,0.08],[-1.04,-1.29],[-3.58,-8.74],[-0.88,-28.74],[7.02,-30.95],[14.96,-22.78],[0,-7.54],[-4.46,-29.08],[3.62,-3.19],[9.11,-1.39],[-0.37,-1.51],[-8.58,-8.66],[-5.38,-0.02],[-3.23,-4.31],[1.03,-3.58],[-0.09,0],[-2.17,0.19],[-22.1,56.63],[-0.11,0.92],[-8.49,29.5],[-22.11,6.15],[-27.39,-1.99],[-7.42,4.22],[-9.82,-12.62],[-3.98,1.41],[2.72,5.97],[5.5,3.1],[3.55,8.74],[-0.67,8.85],[3.89,19.17],[0.47,8.28],[5.58,15.76],[5.18,0.16],[-10.07,-14.52],[0,0]],"v":[[-121.68,148.07],[-114.89,138.45],[-82.54,105.41],[-79.06,100.58],[-61.54,93.88],[19.34,93.28],[32.59,95.64],[40.08,106.85],[73.29,213.72],[79.74,214.06],[77.21,209.77],[72.25,167.86],[75.7,123.98],[104.86,59.31],[133.87,-51.35],[130.47,-81.03],[136.96,-148.26],[159.61,-154.12],[173.5,-158.59],[166.59,-168.82],[136.56,-184.08],[122.88,-190.95],[120.12,-206.01],[122.43,-214.62],[122.15,-214.6],[112.58,-212.34],[80.22,-69.2],[79.67,-66.47],[25.56,-10.52],[-45.73,-7.94],[-115.8,-2.25],[-137.85,-6.63],[-168.35,-21.83],[-173.52,-8.93],[-162.57,1.67],[-144.53,19.86],[-144.99,54.58],[-141.43,84.26],[-144.72,143.99],[-135.59,182.99],[-120.32,214.59],[-107.32,214.81],[-121.69,148.07]]}}},{"ty":"sh","nm":"Path 3","d":1,"ks":{"a":0,"k":{"c":true,"i":[],"o":[],"v":[]}}},{"ty":"sh","nm":"Path 4","d":1,"ks":{"a":0,"k":{"c":true,"i":[[0,-0.01],[0,0.01]],"o":[[0,0],[0,0]],"v":[[72.11,246.9],[72.13,246.89]]}}},{"ty":"sh","nm":"Path 5","d":1,"ks":{"a":0,"k":{"c":true,"i":[[0,0],[2.87,2.33],[-1.86,25.97],[-2.14,2.7],[3.68,18.09],[-1.51,14.37],[-0.23,0.85],[0.1,1.55],[1.01,0.57],[7.29,20.08],[0.03,1.89],[-8.66,3.06],[-17.71,-16.07],[-26.37,-1.91],[-11.12,36.36],[-25.08,63.89],[-0.17,0.37],[-11,3.4],[-3.37,0.24],[-9.11,-11.22],[1.34,-9.01],[-1.33,-23.29],[44.2,-5.26],[0.04,-0.01],[-1.41,-9.18],[-0.01,-10.14],[17.08,-26.01],[5.62,-25.77],[0.48,-1.07],[-1.67,-15.25],[-3.4,-3.64],[4.37,-10.11],[17.97,-1.08],[7.4,0.44],[2.03,-0.04],[4.24,4.83],[11.87,57.4],[26.32,4],[16.03,-11.97],[-9.56,-12.9],[6.86,-12.93],[22.81,0],[7.97,0.33]],"o":[[-3.69,-0.16],[-22.87,-18.58],[0.25,-3.44],[5.73,-7.26],[-2.56,-12.61],[0.09,-0.88],[2.2,-8.29],[-0.83,-0.54],[-7.54,-4.25],[-0.65,-1.78],[-0.63,-34.9],[18.5,-6.54],[23.37,-8.23],[49.58,3.59],[9.04,-76.15],[0.15,-0.38],[3.4,-7.13],[5.9,-1.82],[8.28,-0.6],[5.77,7.12],[24.71,8.84],[0.6,10.39],[-0.04,0],[-0.14,8.71],[1.95,12.71],[0.08,76.66],[-9.81,14.94],[-0.25,1.15],[-2.26,7.73],[3.04,1.92],[11.22,11.99],[-2.12,6.63],[-7.3,0.44],[-3.4,-0.2],[-6.09,1.44],[-17.03,-19.4],[-15.9,2.07],[-7.98,11.01],[-1.84,14.56],[6.85,9.25],[-5.96,11.23],[-6.31,0],[0,0]],"v":[[-128.73,248.66],[-138.84,244.83],[-179.01,137.39],[-175.35,127.96],[-175.11,91.1],[-179.06,49.83],[-178.58,47.23],[-176.34,33.43],[-179.45,31.61],[-206.89,0.18],[-207.92,-5.37],[-179.82,-54.22],[-120.14,-37.86],[-43.27,-42.21],[46.24,-74.71],[82.15,-228.93],[82.63,-230.05],[104.03,-245.71],[119.61,-248.87],[152.41,-239.36],[157.45,-214.47],[207.88,-160.01],[160.89,-119.64],[160.77,-119.63],[164.42,-86.26],[168.22,-51.41],[133.57,78.15],[108.88,132.97],[107.78,136.32],[108.09,190.18],[117.77,198.4],[128.41,233.21],[101.98,248.89],[78.88,248.4],[68.93,247.97],[52.09,242.58],[9.56,129.71],[-57.57,129.5],[-89.64,162.58],[-74.66,201.34],[-66.14,235.03],[-107.36,249.21],[-128.74,248.65]]}}},{"ty":"mm","nm":"Merge Paths 1","mm":1},{"ty":"mm","nm":"Merge Paths 2","mm":4},{"ty":"fl","nm":"Fill 1","c":{"a":0,"k":[0,0,0]},"r":1,"o":{"a":0,"k":100}},{"ty":"tr","a":{"a":0,"k":[0,0]},"s":{"a":0,"k":[100,100]},"p":{"a":0,"k":[207.94,249.22]},"r":{"a":0,"k":0},"sa":{"a":0,"k":0},"o":{"a":0,"k":100}}]}],"ind":1}],"v":"5.7.0","fr":30,"op":38,"ip":0,"assets":[]};

            if (!window.lottie) {
                throw new Error('Lottie failed to load');
            }

            window.lottie.loadAnimation({
                container: container,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                animationData: animationData,
                rendererSettings: {
                    preserveAspectRatio: 'xMidYMid slice'
                }
            });


        } catch (error) {
            console.error('Failed to load Lottie animation:', error);
            // Fallback: just show emoji
            container.textContent = 'рџ¦™';
            container.addClass('oa-fallback-icon');
        }
    }
}

