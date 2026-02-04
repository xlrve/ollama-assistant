export {};

declare global {
    type ObsidianCreateElOptions = {
        cls?: string | string[];
        text?: string;
        attr?: Record<string, string>;
    };

    interface HTMLElement {
        createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ObsidianCreateElOptions): HTMLElementTagNameMap[K];
        createEl(tag: string, options?: ObsidianCreateElOptions): HTMLElement;

        createSpan(options?: ObsidianCreateElOptions): HTMLSpanElement;

        empty(): void;

        /**
         * Internal linkage used by our renderers to associate DOM with message ids.
         */
        _msgId?: string;

        /**
         * Internal cache used by reasoning renderer to rehydrate reasoning UI state.
         */
        _finalizedReasoningData?: {
            html?: string;
            collapsed?: boolean;
            mode?: string;
            turnId?: string;
        };
    }

    type LottieRendererType = 'svg' | 'canvas' | 'html';

    type LottieLoadAnimationOptions = {
        container: Element;
        renderer: LottieRendererType;
        loop: boolean;
        autoplay: boolean;
        animationData: unknown;
        rendererSettings?: Record<string, unknown>;
    };

    interface LottiePlayer {
        loadAnimation(options: LottieLoadAnimationOptions): unknown;
    }

    interface Window {
        lottie?: LottiePlayer;
    }
}
