/**
 * Store - centralized application state storage
 * Implements Observable pattern for reactive updates
 */

import type { AppState } from '../state/types';
import { createInitialAppState } from '../state/types';

type Listener = (state: AppState) => void;
type Selector<T> = (state: AppState) => T;

export class Store {
    private state: AppState;
    private listeners: Set<Listener> = new Set();
    private debugMode: boolean = false;

    constructor(initialState?: Partial<AppState>) {
        this.state = initialState
            ? { ...createInitialAppState(), ...initialState }
            : createInitialAppState();
    }

    /**
     * Enable/disable state change logging
     */
    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
    }

    /**
     * Get current state (read-only)
     */
    getState(): Readonly<AppState> {
        return this.state;
    }

    /**
     * Update state (immutable)
     */
    setState(updater: (state: AppState) => AppState): void {
        const oldState = this.state;
        this.state = updater(oldState);

        if (this.debugMode) {
            console.debug('[Store] State updated:', {
                old: oldState,
                new: this.state
            });
        }

        this.notify();
    }

    /**
     * Subscribe to state changes
     */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);

        if (this.debugMode) {
            console.debug(`[Store] Listener subscribed (total: ${this.listeners.size})`);
        }

        // Return unsubscribe function
        return () => {
            this.listeners.delete(listener);
            if (this.debugMode) {
                console.debug(`[Store] Listener unsubscribed (total: ${this.listeners.size})`);
            }
        };
    }

    /**
     * Subscribe with selector (optimization)
     * Called only when selected part of state changes
     */
    select<T>(selector: Selector<T>, listener: (value: T) => void): () => void {
        let previousValue = selector(this.state);

        const wrappedListener = (state: AppState) => {
            const newValue = selector(state);
            if (newValue !== previousValue) {
                previousValue = newValue;
                listener(newValue);
            }
        };

        return this.subscribe(wrappedListener);
    }

    /**
     * Notify all subscribers about state change
     */
    private notify(): void {
        this.listeners.forEach(listener => {
            try {
                listener(this.state);
            } catch (error) {
                console.error('[Store] Error in listener:', error);
            }
        });
    }

    /**
     * Clear all subscriptions (for cleanup)
     */
    clear(): void {
        this.listeners.clear();
        if (this.debugMode) {
            console.debug('[Store] All listeners cleared');
        }
    }
}
