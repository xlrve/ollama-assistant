import type { App } from 'obsidian';

/**
 * LocalStorageSettings - manages device-specific settings that should NOT sync between devices.
 * Uses Obsidian's localStorage API with plugin-prefixed keys.
 */
export class LocalStorageSettings {
    private prefix = 'ollama-assistant:';

    constructor(private app: App) {}

    // Model
    getModel(): string | null {
        return this.app.loadLocalStorage(this.prefix + 'model');
    }

    setModel(value: string): void {
        this.app.saveLocalStorage(this.prefix + 'model', value);
    }

    // Base URL
    getBaseUrl(): string | null {
        return this.app.loadLocalStorage(this.prefix + 'baseUrl');
    }

    setBaseUrl(value: string): void {
        this.app.saveLocalStorage(this.prefix + 'baseUrl', value);
    }

    // Temperature
    getTemperature(): number | null {
        const value = this.app.loadLocalStorage(this.prefix + 'temperature');
        return value !== null ? parseFloat(value) : null;
    }

    setTemperature(value: number): void {
        this.app.saveLocalStorage(this.prefix + 'temperature', value.toString());
    }

    // Default context size
    getDefaultContextSize(): number | null {
        const value = this.app.loadLocalStorage(this.prefix + 'defaultContextSize');
        return value !== null ? parseInt(value, 10) : null;
    }

    setDefaultContextSize(value: number): void {
        this.app.saveLocalStorage(this.prefix + 'defaultContextSize', value.toString());
    }

    // Max history messages
    getMaxHistoryMessages(): number | null {
        const value = this.app.loadLocalStorage(this.prefix + 'maxHistoryMessages');
        return value !== null ? parseInt(value, 10) : null;
    }

    setMaxHistoryMessages(value: number): void {
        this.app.saveLocalStorage(this.prefix + 'maxHistoryMessages', value.toString());
    }

    // Force enable web mode
    getForceEnableWebMode(): boolean | null {
        const value = this.app.loadLocalStorage(this.prefix + 'forceEnableWebMode');
        return value !== null ? value === 'true' : null;
    }

    setForceEnableWebMode(value: boolean): void {
        this.app.saveLocalStorage(this.prefix + 'forceEnableWebMode', value.toString());
    }

    // Reset all device-specific settings
    resetAll(): void {
        this.app.saveLocalStorage(this.prefix + 'model', null);
        this.app.saveLocalStorage(this.prefix + 'baseUrl', null);
        this.app.saveLocalStorage(this.prefix + 'temperature', null);
        this.app.saveLocalStorage(this.prefix + 'defaultContextSize', null);
        this.app.saveLocalStorage(this.prefix + 'maxHistoryMessages', null);
        this.app.saveLocalStorage(this.prefix + 'forceEnableWebMode', null);
    }
}
