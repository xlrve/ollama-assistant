/**
 * EventBus - central event bus for all modules
 * Implements Pub/Sub pattern for component decoupling
 */

import type { Turn } from '../types';
import type { AppState } from '../state/types';

export type EventMap = {
    // === Generation events ===
    'generation:start': { tab: 'edit' | 'discuss' | 'web'; message: string };
    'generation:chunk': { tab: 'edit' | 'discuss' | 'web'; content: string; isThinking?: boolean };
    'generation:completed': { tab: 'edit' | 'discuss' | 'web' };
    'generation:stopped': { tab: 'edit' | 'discuss' | 'web' };
    'generation:error': { tab: 'edit' | 'discuss' | 'web'; error: string };

    // === UI events ===
    'mode:switched': { from: 'edit' | 'discuss' | 'web'; to: 'edit' | 'discuss' | 'web' };
    'context:added': { text: string; isEntireNote: boolean };
    'context:cleared': void;
    'message:updated': { tab: 'edit' | 'discuss' | 'web'; messageId: string; content: string };

    // === State events ===
    'state:changed': { state: AppState };

    // === App lifecycle ===
    'app:ready': void;
    'app:cleanup': void;

    // === Edit events ===
    'edit:apply': { content: string; editNumber: number };
    'edit:applyWithHistory': { content: string; editNumber: number };
    'edit:addToContext': { content: string; editNumber: number };

    // === History events ===
    'history:save': void;
    'history:load': void;
    'history:clear': { tab?: 'edit' | 'discuss' | 'web' };

    // === Connection events ===
    'connection:changed': { connected: boolean };
    'connection:check': void;  // Trigger refresh of connection status
    'model:changed': { model: string };

    // === Settings events ===
    'context:sizeChanged': { newSize: number };

    // === Token metrics events ===
    'tokens:counted': { tab: 'edit' | 'discuss' | 'web'; promptTokens: number; responseTokens: number; speed: number };

    // === Rendering events (adapter bridge) ===
    'render:addSystemMessage': {
        content: string;
        isStopMessage?: boolean;
        mode: 'edit' | 'discuss' | 'web';
        isError?: boolean;
        afterId?: string;
        messageId?: string;
        turnId?: string;
    };
    'render:addUserMessage': {
        content: string;
        mode: 'edit' | 'discuss' | 'web';
        msgId: string;
        contextContent?: string;
        contextLabel?: string;
        turnId?: string;
    };
    'render:addUserMessageQueued': {
        content: string;
        mode: 'edit' | 'discuss' | 'web';
        afterId?: string;
        messageId: string;
        contextContent?: string;
        contextLabel?: string;
        turnId?: string;
    };
    'render:addStreamingMessage': {
        mode: 'edit' | 'discuss' | 'web';
        messageId: string;
        isResult?: boolean;
        afterId?: string;
        editNumber?: number;
        turnId?: string;
    };
    'render:updateStreamingMessage': {
        mode: 'edit' | 'discuss' | 'web';
        messageId: string;
        content: string;
    };
    'render:finalizeStreamingMessage': {
        messageId: string;
        content: string;
        mode: 'edit' | 'discuss' | 'web';
        turnId?: string;
    };
    'render:finalizeResultMessage': {
        messageId: string;
        resultContent: string;
        rawContent: string;
        mode: 'edit' | 'discuss' | 'web';
        editNumber?: number;
        turnId?: string;
    };
    'render:finalizeExplanationMessage': {
        messageId: string;
        mode: 'edit' | 'discuss' | 'web';
        content: string;
        turnId?: string;
    };
    'render:addReasoningBlock': {
        mode: 'edit' | 'discuss' | 'web';
        turnId: string;
        afterId?: string;
        reasoningId?: string;
        appendToEnd?: boolean;
    };
    'render:updateReasoningBlock': {
        mode: 'edit' | 'discuss' | 'web';
        turnId: string;
        content: string;
    };
    'render:finalizeReasoningBlock': {
        mode: 'edit' | 'discuss' | 'web';
        turnId: string;
    };
    'render:clearStreaming': {
        mode: 'edit' | 'discuss' | 'web';
    };
    'render:addWelcomeMessages': void;
    'render:clearTab': {
        mode: 'edit' | 'discuss' | 'web';
    };
    'render:clearAllTabs': void;
    
    // === History restoration events (Turn-based) ===
    'render:restoreTurn': {
        turn: Turn;
        mode: 'edit' | 'discuss' | 'web';
    };
    'render:restoreTurns': {
        turns: Turn[];
        mode: 'edit' | 'discuss' | 'web';
    };
    'message:rendered': {
        messageId: string;
        mode: 'edit' | 'discuss' | 'web';
        uiData: {
            html?: string;
            classes?: string;
            editNumber?: number;
            resultContent?: string;
            contextContent?: string;
            contextLabel?: string;
            contextStart?: number;
            contextEnd?: number;
            turnId?: string;
            positionData?: {
                text: string;
                start: number;
                end: number;
                isWholeNote: boolean;
                anchorBefore?: string;
                anchorAfter?: string;
            };
            reasoningHtml?: string;
            reasoningCollapsed?: boolean;
            reasoningId?: string;
            isStopMessage?: boolean;
            isError?: boolean;
            originalMessage?: string;
        };
    };

    // === Drag and Drop events ===
    'dragdrop:started': {
        hasText: boolean;
    };
    'dragdrop:ended': void;
    'dragdrop:hovering': {
        isOver: boolean;
    };
    'dragdrop:textAdded': {
        text: string;
    };
};

type EventHandler<T> = (data: T) => void | Promise<void>;

export class EventBus {
    private handlers: Map<keyof EventMap, Set<EventHandler<unknown>>> = new Map();
    private debugMode: boolean = false;

    /**
     * Enable/disable event logging for debugging
     */
    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
    }

    /**
     * Subscribe to an event
     */
    on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(handler);

        if (this.debugMode) {
            console.debug(`[EventBus] Subscribed to "${event}"`);
        }
    }

    /**
     * Unsubscribe from an event
     */
    off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
        const handlers = this.handlers.get(event);
        if (handlers) {
            handlers.delete(handler);
            if (this.debugMode) {
                console.debug(`[EventBus] Unsubscribed from "${event}"`);
            }
        }
    }

    /**
     * Emit an event
     */
    emit<K extends keyof EventMap>(
        event: K,
        ...args: EventMap[K] extends void ? [] : [EventMap[K]]
    ): void {
        const handlers = this.handlers.get(event);
        const data = args[0];

        if (this.debugMode) {
            console.debug(`[EventBus] Emit "${event}"`, data);
        }

        if (handlers) {
            handlers.forEach(handler => {
                try {
                    void (handler as EventHandler<EventMap[K]>)(data as EventMap[K]);
                } catch (error) {
                    console.error(`[EventBus] Error in handler for "${event}":`, error);
                }
            });
        }
    }

    /**
     * Subscribe to an event once
     */
    once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
        const onceHandler: EventHandler<EventMap[K]> = (data) => {
            void handler(data);
            this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
    }

    /**
     * Clear all subscriptions (for cleanup)
     */
    clear(): void {
        this.handlers.clear();
        if (this.debugMode) {
            console.debug('[EventBus] All handlers cleared');
        }
    }

    /**
     * Get the number of subscribers for an event (for debugging)
     */
    getHandlerCount(event: keyof EventMap): number {
        return this.handlers.get(event)?.size || 0;
    }
}
