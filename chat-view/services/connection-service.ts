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
    private intervalId: number | null = null;

    constructor(private deps: ConnectionServiceDeps) {}

    async start(intervalMs: number = 3000): Promise<void> {
        // Defensive: avoid duplicate intervals if start() is called repeatedly.
        this.stop();
        // Execute immediately and wait for result
        await this.checkOnce();
        // Start periodic check
        this.intervalId = window.setInterval(() => {
            void this.checkOnce();
        }, intervalMs);
    }

    checkNow(): Promise<void> {
        return this.checkOnce();
    }

    stop(): void {
        if (this.intervalId) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
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
