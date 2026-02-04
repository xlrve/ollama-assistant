import type { EventBus } from '../core/event-bus';
import type { OllamaMessage, OllamaTool, StreamChunk } from '../../ollama-client';

interface StreamOptions {
    tab: 'edit' | 'discuss' | 'web';
    messages: OllamaMessage[];
    client: {
        chatStream: (
            messages: OllamaMessage[],
            onChunk: (chunk: StreamChunk) => void,
            signal?: AbortSignal,
            tools?: OllamaTool[]
        ) => Promise<void>;
    };
    signal?: AbortSignal;
    tools?: OllamaTool[];
    onChunk?: (chunk: StreamChunk) => void;
}

/**
 * StreamingHandler
 * Wraps chatStream and throttles generation:chunk events.
 * UI independent.
 */
export class StreamingHandler {
    private throttleTimer: number | null = null;
    private pendingThinking = '';
    private pendingContent = '';
    private readonly throttleMs: number;

    constructor(
        private eventBus: EventBus,
        throttleMs: number = 30
    ) {
        this.throttleMs = throttleMs;
    }

    /**
     * Starts stream and forwards chunks to onChunk + EventBus (with throttling)
     */
    async stream(options: StreamOptions): Promise<void> {
        this.reset();

        try {
            await options.client.chatStream(
                options.messages,
                (chunk: StreamChunk) => {
                    // Throttle only thinking/content for EventBus
                    if (chunk.type === 'thinking') {
                        this.pendingThinking += chunk.text;
                        this.scheduleFlush(options.tab);
                    } else if (chunk.type === 'content') {
                        this.pendingContent += chunk.text;
                        this.scheduleFlush(options.tab);
                    }

                    // Custom handler (UI/logic)
                    if (options.onChunk) {
                        options.onChunk(chunk);
                    }
                },
                options.signal,
                options.tools
            );
        } finally {
            // Ensure final accumulated chunks go to EventBus
            this.flush(options.tab);
            this.clearTimer();
        }
    }

    /**
     * Resets accumulated strings and timer (use before new stream)
     */
    reset(): void {
        this.pendingThinking = '';
        this.pendingContent = '';
        this.clearTimer();
    }

    private scheduleFlush(tab: 'edit' | 'discuss' | 'web'): void {
        if (this.throttleTimer !== null) return;

        this.throttleTimer = window.setTimeout(() => {
            this.flush(tab);
            this.clearTimer();
        }, this.throttleMs);
    }

    private flush(tab: 'edit' | 'discuss' | 'web'): void {
        if (this.pendingThinking.length > 0) {
            this.eventBus.emit('generation:chunk', {
                tab,
                content: this.pendingThinking,
                isThinking: true
            });
            this.pendingThinking = '';
        }

        if (this.pendingContent.length > 0) {
            this.eventBus.emit('generation:chunk', {
                tab,
                content: this.pendingContent,
                isThinking: false
            });
            this.pendingContent = '';
        }
    }

    private clearTimer(): void {
        if (this.throttleTimer !== null) {
            window.clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }
    }
}
