import type { App } from 'obsidian';
import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';
import { Actions } from '../core/actions';

interface ConnectionServiceDeps {
    app: App;
    eventBus: EventBus;
    store: Store;
    refreshConnectionAndTools: () => Promise<void>;
    getLastKnownConnectionState: () => boolean | null;
    setLastKnownConnectionState: (state: boolean | null) => void;
}

/**
 * ConnectionService - manages periodic connection checks and event publishing.
 */
export class ConnectionService {
    private timeoutId: number | null = null;
    private intervalMs: number = 3000;
    private running: boolean = false;

    constructor(private deps: ConnectionServiceDeps) {}

    async start(intervalMs: number = 3000): Promise<void> {
        this.stop();
        this.intervalMs = intervalMs;
        this.running = true;
        await this.checkOnce();
        this.scheduleNextCheck();
    }

    checkNow(): Promise<void> {
        return this.checkOnce();
    }

    stop(): void {
        this.running = false;
        if (this.timeoutId) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    private scheduleNextCheck(): void {
        if (!this.running) return;

        this.timeoutId = window.setTimeout(() => {
            void (async () => {
                try {
                    await this.checkOnce();
                } catch (error) {
                    console.warn('Connection check failed:', error);
                } finally {
                    this.scheduleNextCheck();
                }
            })();
        }, this.intervalMs);
    }

    private async checkOnce(): Promise<void> {
        await this.deps.refreshConnectionAndTools();

        // Store is already updated inside refreshConnectionAndTools; emit event if state changed
        const connected = this.deps.store.getState().ui.isConnected;
        const last = this.deps.getLastKnownConnectionState();
        if (last !== connected) {
            this.deps.setLastKnownConnectionState(connected);
            this.deps.eventBus.emit('connection:changed', { connected });
            Actions.setConnected(this.deps.store, connected);
        }
    }
}
