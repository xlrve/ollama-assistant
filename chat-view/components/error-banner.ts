/**
 * ErrorBanner - shows error banner when Ollama is unavailable
 * Event-Driven: listens to connection:changed events,
 * manages banner UI, typing animation, UI blocking, Lottie animation.
 */

import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';
import { Actions } from '../core/actions';
import lottie from 'lottie-web';

export type ErrorBannerDeps = {
    getChatBlockWrapperEl: () => HTMLElement | null;
    getChatContainerEl: () => HTMLElement | null;
    getTextareaEl: () => HTMLTextAreaElement | null;
    getSendButtonEl: () => HTMLButtonElement | null;
    getModelButtonEl: () => HTMLButtonElement | null;
    getQuickEditsButtonEl: () => HTMLButtonElement | null;
    getAddContextButtonEl: () => HTMLButtonElement | null;
    getContextPinButtonEl: () => HTMLButtonElement | null;
    getContextCloseButtonEl: () => HTMLButtonElement | null;
    getInputContainerEl: () => HTMLElement | null;
    getBodyEl: () => HTMLElement;
    getHeadEl: () => HTMLElement;
};

export class ErrorBanner {
    private bannerEl: HTMLElement | null = null;
    private isShown: boolean = false;

    // Typing animation state
    private typingAnimationTimer: number | null = null;
    private typingAnimationRunning: boolean = false;
    private typingAnimationState: {
        commands: string[];
        currentIndex: number;
        currentText: string;
        isTyping: boolean;
    } = {
        commands: ['ollama serve', 'ollama list', 'ollama run qwen2.5'],
        currentIndex: 0,
        currentText: '',
        isTyping: true
    };

    // Saved textarea states (for restoration after reconnect)
    private savedTextareaStates: Map<string, string> = new Map();

    constructor(
        private eventBus: EventBus,
        private store: Store,
        private deps: ErrorBannerDeps
    ) {
        // Subscribe to events
        this.eventBus.on('connection:changed', this.handleConnectionChanged.bind(this));
        this.eventBus.on('app:ready', this.initialize.bind(this));
    }

    /**
     * Initialize banner element
     */
    private initialize(): void {
        // Banner will be created on first show
    }

    /**
     * Handle connection status change
     */
    private handleConnectionChanged(data: { connected: boolean }): void {
        if (!data.connected) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Show error banner
     */
    show(): void {
        if (this.isShown) return;

        // Create banner if doesn't exist
        if (!this.bannerEl) {
            this.bannerEl = this.createBanner();
        }

        this.bannerEl.removeClass('oa-hidden');
        this.isShown = true;

        // Disable UI when Ollama is not running
        this.setUIEnabled(false);

        // Save current textarea states from ALL tabs before clearing
        this.savedTextareaStates.clear();
        const state = this.store.getState();
        
        // Save textarea content from ALL tabs (Store is always synced now)
        Object.entries(state.tabs).forEach(([mode, tabState]) => {
            if (tabState.textareaContent) {
                this.savedTextareaStates.set(mode, tabState.textareaContent);
            }
        });

        // Clear textarea visually
        const textarea = this.deps.getTextareaEl();
        if (textarea) {
            textarea.value = '';
        }

        // Clear textareaContent from ALL tab states (will be restored on reconnect)
        Actions.clearAllTextareas(this.store);

        // Start typing animation to show user helpful suggestions
        this.startTypingAnimation();
    }

    /**
     * Hide error banner
     */
    hide(): void {
        if (!this.isShown) return;

        if (this.bannerEl) {
            this.bannerEl.addClass('oa-hidden');
        }

        this.isShown = false;

        // Re-enable UI when Ollama connects
        this.setUIEnabled(true);

        // Restore saved textarea states from ALL tabs
        const state = this.store.getState();
        (Object.keys(state.tabs) as Array<keyof typeof state.tabs>).forEach((mode) => {
            const savedContent = this.savedTextareaStates.get(mode);
            if (savedContent) {
                Actions.setTextareaContent(this.store, mode, savedContent);
            }
        });

        // Restore current tab's textarea value
        const textarea = this.deps.getTextareaEl();
        if (textarea) {
            const currentTab = state.ui.currentTab;
            const savedContent = this.savedTextareaStates.get(currentTab);
            textarea.value = savedContent || '';
        }

        // Clear saved states after restoration
        this.savedTextareaStates.clear();
    }

    /**
     * Create banner element
     */
    private createBanner(): HTMLElement {
        const chatBlock = this.deps.getChatBlockWrapperEl();
        if (!chatBlock) {
            // Fallback: create temporary banner
            const banner = document.createElement('div');
            banner.className = 'ollama-error-banner';
            return banner;
        }

        // Create error banner as overlay inside chat block wrapper
        const banner = (chatBlock).createEl('div', { cls: 'ollama-error-banner' });

        // Check if container is in compact mode and apply to banner
        const container = this.deps.getChatContainerEl();
        if (container && container.classList.contains('compact-mode')) {
            banner.addClass('compact-mode');
        }

        // Llama icon wrapper with Lottie animation
        const iconWrapper = banner.createEl('div', { cls: 'error-banner-icon' });
        void this.loadLottieAnimation(iconWrapper);

        // Content wrapper
        const contentWrapper = banner.createEl('div', { cls: 'error-banner-content' });

        // Title
        contentWrapper.createEl('div', {
            cls: 'error-banner-title',
            text: 'Ollama is not running'
        });

        // Subtitle with clickable Refresh
        const subtitle = contentWrapper.createEl('div', { cls: 'error-banner-subtitle' });
        subtitle.appendText('Please start Ollama, then click ');
        const refreshLink = subtitle.createEl('a', { cls: 'refresh-link', text: 'refresh', attr: { href: '#' } });
        refreshLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.eventBus.emit('connection:check');
        });

        // Divider
        contentWrapper.createEl('div', { cls: 'error-banner-divider' });

        // Help text with links
        const helpText = contentWrapper.createEl('div', { cls: 'error-banner-help' });
        helpText.appendText("Don't have Ollama yet? ");
        helpText.createEl('a', { text: 'Download', attr: { href: 'https://ollama.com/download', target: '_blank', rel: 'noopener' } });
        helpText.appendText(' and set it up, ');
        helpText.createEl('a', { text: 'choose', attr: { href: 'https://ollama.com/library', target: '_blank', rel: 'noopener' } });
        helpText.appendText(' a model, then ');
        const installLink = helpText.createEl('a', { cls: 'install-link', text: 'install it', attr: { href: '#' } });

        // Add tooltip for "install it" link
        installLink.addEventListener('click', (e) => {
            e.preventDefault();
        });

        let tooltip: HTMLElement | null = null;

        installLink.addEventListener('mouseenter', (e) => {
            tooltip = this.deps.getBodyEl().createEl('div', { cls: 'ollama-install-tooltip' });
            tooltip.appendText('To install a model, run the command from the model webpage in your terminal.');
            tooltip.createEl('br');
            tooltip.appendText('For example:');
            tooltip.createEl('br');
            const commandEl = tooltip.createEl('code');
            commandEl.textContent = 'ollama run qwen2.5';

            const rect = (e.target as HTMLElement).getBoundingClientRect();
            tooltip.setCssProps({ '--oa-right': (window.innerWidth - rect.right) + 'px', '--oa-left': 'auto', '--oa-bottom': (window.innerHeight - rect.top + 5) + 'px', '--oa-top': 'auto' });
        });

        installLink.addEventListener('mouseleave', () => {
            if (tooltip) {
                tooltip.remove();
                tooltip = null;
            }
        });

        return banner;
    }

    /**
     * Set compact mode
     */
    setCompactMode(compact: boolean): void {
        if (this.bannerEl) {
            if (compact) {
                this.bannerEl.addClass('compact-mode');
            } else {
                this.bannerEl.removeClass('compact-mode');
            }
        }
    }

    /**
     * Check if typing animation is running
     */
    isTypingAnimationRunning(): boolean {
        return this.typingAnimationRunning;
    }

    /**
     * Enable/disable UI elements
     */
    private setUIEnabled(enabled: boolean): void {
        // Disable/enable textarea
        const textarea = this.deps.getTextareaEl();
        if (textarea) {
            textarea.disabled = !enabled;
        }

        // Disable/enable Send button
        const sendButton = this.deps.getSendButtonEl();
        if (sendButton) {
            sendButton.disabled = !enabled;
        }

        // Disable/enable Model selector button
        const modelButton = this.deps.getModelButtonEl();
        if (modelButton) {
            modelButton.disabled = !enabled;
        }

        // Disable/enable Quick edits button
        const quickEditsButton = this.deps.getQuickEditsButtonEl();
        if (quickEditsButton) {
            quickEditsButton.disabled = !enabled;
        }

        // Disable/enable +Add context button
        const addContextButton = this.deps.getAddContextButtonEl();
        if (addContextButton) {
            addContextButton.disabled = !enabled;
        }

        // Disable/enable context pin button
        const contextPin = this.deps.getContextPinButtonEl();
        if (contextPin) {
            contextPin.disabled = !enabled;
        }

        // Disable/enable context close button
        const contextClose = this.deps.getContextCloseButtonEl();
        if (contextClose) {
            contextClose.disabled = !enabled;
        }

        // Apply opacity to entire input container when disabled
        const inputContainer = this.deps.getInputContainerEl();
        if (inputContainer) {
            inputContainer.toggleClass('oa-input-dimmed', !enabled);
        }

        // Start/stop typing animation in textarea
        if (enabled) {
            this.stopTypingAnimation();
        } else {
            this.startTypingAnimation();
        }
    }

    /**
     * Load Lottie animation
     */
    private async loadLottieAnimation(container: HTMLElement): Promise<void> {
        try {
            // Embedded animation data
            const animationData = {"nm":"Comp 5","ddd":0,"h":500,"w":500,"meta":{"g":"@lottiefiles/toolkit-js 0.68.0"},"layers":[{"ty":4,"nm":"ollama-new32 copy Outlines","sr":1,"st":0,"op":47,"ip":0,"ln":"150","hasMask":false,"ao":0,"ks":{"a":{"a":1,"k":[{"o":{"x":0.167,"y":0.167},"i":{"x":0.833,"y":0.833},"s":[185.679,290.954,0],"t":0},{"o":{"x":0.167,"y":0.167},"i":{"x":0.833,"y":0.833},"s":[185.679,290.954,0],"t":5},{"s":[185.679,290.954,0],"t":10}]},"s":{"a":0,"k":[40,40,100]},"p":{"a":1,"k":[{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,416.282,0],"t":0,"ti":[0,0,0],"to":[0,-17,0]},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,314.282,0],"t":3.863},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,416.282,0],"t":7.727},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,314.282,0],"t":12,"ti":[0,-17,0],"to":[0,0,0]},{"o":{"x":0.333,"y":0.333},"i":{"x":0.667,"y":0.667},"s":[241.071,416.282,0],"t":16},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,416.282,0],"t":20,"ti":[-3.5,-2.333,0],"to":[0,-25,0]},{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[241.071,266.282,0],"t":23,"ti":[-3.5,-27.333,0],"to":[3.5,2.333,0]},{"s":[262.071,430.282,0],"t":31,"ti":[0,17,0],"to":[3.5,27.333,0]}]},"r":{"a":1,"k":[{"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"s":[0],"t":20},{"s":[214],"t":31}]},"sa":{"a":0,"k":0},"o":{"a":0,"k":100}},"shapes":[{"ty":"gr","nm":"Group 1","it":[{"ty":"sh","nm":"Path 1","d":1,"ks":{"a":0,"k":{"c":true,"i":[[0,0],[0,0]],"o":[[0,0],[0,0]],"v":[[107.53,136.89],[107.53,136.88]]}}},{"ty":"sh","nm":"Path 2","d":1,"ks":{"a":0,"k":{"c":true,"i":[[0,0],[-3.32,2.3],[-9.11,12.71],[-1.21,1.66],[-6.65,-1.44],[-0.41,0.09],[-3.92,-2.56],[-0.87,-4.6],[-9.28,-14.31],[-2.39,-0.14],[0.63,1.56],[0.3,9.69],[-1.77,4.55],[-10.39,15.83],[0.07,66.37],[1.67,10.88],[-14.8,13.04],[-11.53,-1.98],[-1.14,0.88],[4.94,4.99],[8.54,0.04],[3.23,4.3],[-1.49,5.18],[-0.53,2.21],[0.09,-0.01],[2.82,-1.03],[8.93,-75.33],[0.26,-0.89],[27.41,-7.62],[24.18,1.76],[16.81,-9.55],[5.24,6.73],[6.11,-2.16],[0.2,-4.75],[-4.99,-2.81],[-4.22,-10.4],[3.88,-15.23],[-2.17,-10.7],[11.55,-19.06],[-5.85,-16.49],[-3.93,-5.36],[-3.53,0.01],[-8,29.5]],"o":[[1.06,-3.91],[17.22,-11.94],[1.12,-1.56],[4,-5.51],[39.79,8.58],[4.55,-1.05],[3.92,2.56],[11.78,62.57],[1.93,0.08],[-1.04,-1.29],[-3.58,-8.74],[-0.88,-28.74],[7.02,-30.95],[14.96,-22.78],[0,-7.54],[-4.46,-29.08],[3.62,-3.19],[9.11,-1.39],[-0.37,-1.51],[-8.58,-8.66],[-5.38,-0.02],[-3.23,-4.31],[1.03,-3.58],[-0.09,0],[-2.17,0.19],[-22.1,56.63],[-0.11,0.92],[-8.49,29.5],[-22.11,6.15],[-27.39,-1.99],[-7.42,4.22],[-9.82,-12.62],[-3.98,1.41],[2.72,5.97],[5.5,3.1],[3.55,8.74],[-0.67,8.85],[3.89,19.17],[0.47,8.28],[5.58,15.76],[5.18,0.16],[-10.07,-14.52],[0,0]],"v":[[-121.68,148.07],[-114.89,138.45],[-82.54,105.41],[-79.06,100.58],[-61.54,93.88],[19.34,93.28],[32.59,95.64],[40.08,106.85],[73.29,213.72],[79.74,214.06],[77.21,209.77],[72.25,167.86],[75.7,123.98],[104.86,59.31],[133.87,-51.35],[130.47,-81.03],[136.96,-148.26],[159.61,-154.12],[173.5,-158.59],[166.59,-168.82],[136.56,-184.08],[122.88,-190.95],[120.12,-206.01],[122.43,-214.62],[122.15,-214.6],[112.58,-212.34],[80.22,-69.2],[79.67,-66.47],[25.56,-10.52],[-45.73,-7.94],[-115.8,-2.25],[-137.85,-6.63],[-168.35,-21.83],[-173.52,-8.93],[-162.57,1.67],[-144.53,19.86],[-144.99,54.58],[-141.43,84.26],[-144.72,143.99],[-135.59,182.99],[-120.32,214.59],[-107.32,214.81],[-121.69,148.07]]}}},{"ty":"sh","nm":"Path 3","d":1,"ks":{"a":0,"k":{"c":true,"i":[],"o":[],"v":[]}}},{"ty":"sh","nm":"Path 4","d":1,"ks":{"a":0,"k":{"c":true,"i":[[0,-0.01],[0,0.01]],"o":[[0,0],[0,0]],"v":[[72.11,246.9],[72.13,246.89]]}}},{"ty":"sh","nm":"Path 5","d":1,"ks":{"a":0,"k":{"c":true,"i":[[0,0],[2.87,2.33],[-1.86,25.97],[-2.14,2.7],[3.68,18.09],[-1.51,14.37],[-0.23,0.85],[0.1,1.55],[1.01,0.57],[7.29,20.08],[0.03,1.89],[-8.66,3.06],[-17.71,-16.07],[-26.37,-1.91],[-11.12,36.36],[-25.08,63.89],[-0.17,0.37],[-11,3.4],[-3.37,0.24],[-9.11,-11.22],[1.34,-9.01],[-1.33,-23.29],[44.2,-5.26],[0.04,-0.01],[-1.41,-9.18],[-0.01,-10.14],[17.08,-26.01],[5.62,-25.77],[0.48,-1.07],[-1.67,-15.25],[-3.4,-3.64],[4.37,-10.11],[17.97,-1.08],[7.4,0.44],[2.03,-0.04],[4.24,4.83],[11.87,57.4],[26.32,4],[16.03,-11.97],[-9.56,-12.9],[6.86,-12.93],[22.81,0],[7.97,0.33]],"o":[[-3.69,-0.16],[-22.87,-18.58],[0.25,-3.44],[5.73,-7.26],[-2.56,-12.61],[0.09,-0.88],[2.2,-8.29],[-0.83,-0.54],[-7.54,-4.25],[-0.65,-1.78],[-0.63,-34.9],[18.5,-6.54],[23.37,-8.23],[49.58,3.59],[9.04,-76.15],[0.15,-0.38],[3.4,-7.13],[5.9,-1.82],[8.28,-0.6],[5.77,7.12],[24.71,8.84],[0.6,10.39],[-0.04,0],[-0.14,8.71],[1.95,12.71],[0.08,76.66],[-9.81,14.94],[-0.25,1.15],[-2.26,7.73],[3.04,1.92],[11.22,11.99],[-2.12,6.63],[-7.3,0.44],[-3.4,-0.2],[-6.09,1.44],[-17.03,-19.4],[-15.9,2.07],[-7.98,11.01],[-1.84,14.56],[6.85,9.25],[-5.96,11.23],[-6.31,0],[0,0]],"v":[[-128.73,248.66],[-138.84,244.83],[-179.01,137.39],[-175.35,127.96],[-175.11,91.1],[-179.06,49.83],[-178.58,47.23],[-176.34,33.43],[-179.45,31.61],[-206.89,0.18],[-207.92,-5.37],[-179.82,-54.22],[-120.14,-37.86],[-43.27,-42.21],[46.24,-74.71],[82.15,-228.93],[82.63,-230.05],[104.03,-245.71],[119.61,-248.87],[152.41,-239.36],[157.45,-214.47],[207.88,-160.01],[160.89,-119.64],[160.77,-119.63],[164.42,-86.26],[168.22,-51.41],[133.57,78.15],[108.88,132.97],[107.78,136.32],[108.09,190.18],[117.77,198.4],[128.41,233.21],[101.98,248.89],[78.88,248.4],[68.93,247.97],[52.09,242.58],[9.56,129.71],[-57.57,129.5],[-89.64,162.58],[-74.66,201.34],[-66.14,235.03],[-107.36,249.21],[-128.74,248.65]]}}},{"ty":"mm","nm":"Merge Paths 1","mm":1},{"ty":"mm","nm":"Merge Paths 2","mm":4},{"ty":"fl","nm":"Fill 1","c":{"a":0,"k":[0,0,0]},"r":1,"o":{"a":0,"k":100}},{"ty":"tr","a":{"a":0,"k":[0,0]},"s":{"a":0,"k":[100,100]},"p":{"a":0,"k":[207.94,249.22]},"r":{"a":0,"k":0},"sa":{"a":0,"k":0},"o":{"a":0,"k":100}}]}],"ind":1}],"v":"5.7.0","fr":30,"op":47,"ip":0,"assets":[]};

            // Create lottie animation
            lottie.loadAnimation({
                container: container,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                animationData: animationData,
                rendererSettings: {
                    preserveAspectRatio: 'xMidYMid slice',
                    progressiveLoad: false,
                    hideOnTransparent: true
                }
            });
        } catch (error) {
            console.error('Failed to load Lottie animation:', error);
            // Fallback to simple SVG if Lottie fails
            container.empty();
            const svg = container.createSvg('svg', { attr: { viewBox: '0 0 100 100', fill: 'currentColor' } });
            svg.createSvg('path', { attr: { d: 'M50 10 Q45 5 40 10 L35 25 Q33 30 35 35 L40 50 Q42 55 45 60 L50 90 Q55 95 60 90 L65 60 Q68 55 70 50 L75 35 Q77 30 75 25 L70 10 Q65 5 60 10 Z' } });
            svg.createSvg('circle', { attr: { cx: '42', cy: '35', r: '3' } });
            svg.createSvg('circle', { attr: { cx: '58', cy: '35', r: '3' } });
            svg.createSvg('path', { attr: { d: 'M40 45 Q50 50 60 45', stroke: 'currentColor', 'stroke-width': '2', fill: 'none' } });
        }
    }

    /**
     * Start typing animation in textarea
     */
    private startTypingAnimation(): void {
        // Stop any existing animation
        this.stopTypingAnimation();

        const textarea = this.deps.getTextareaEl();
        if (!textarea) return;

        // Mark animation as running
        this.typingAnimationRunning = true;

        // Reset state
        this.typingAnimationState.currentIndex = 0;
        this.typingAnimationState.currentText = '';
        this.typingAnimationState.isTyping = true;

        const prefix = 'In your terminal: ';
        const placeholderText = 'Write a command for AI...';

        // First, erase placeholder text
        const erasePlaceholder = () => {
            let remainingText = placeholderText;

            const eraseStep = () => {
                if (remainingText.length > 0) {
                    remainingText = remainingText.substring(0, remainingText.length - 1);
                    textarea.setAttribute('placeholder', remainingText);
                    this.typingAnimationTimer = window.setTimeout(eraseStep, 60);
                } else {
                    // Placeholder erased, now type the prefix
                    textarea.setAttribute('placeholder', '');
                    this.typingAnimationTimer = window.setTimeout(typePrefix, 500);
                }
            };

            // Start erasing placeholder
            this.typingAnimationTimer = window.setTimeout(eraseStep, 300);
        };

        // Type "In your terminal: " character by character
        const typePrefix = () => {
            let typedPrefix = '';

            const typeStep = () => {
                if (typedPrefix.length < prefix.length) {
                    typedPrefix = prefix.substring(0, typedPrefix.length + 1);
                    textarea.value = typedPrefix;
                    // Apply text color to animation text
                    textarea.addClass('oa-text-normal');
                    this.typingAnimationTimer = window.setTimeout(typeStep, 80);
                } else {
                    // Prefix typed, now start main animation loop
                    this.typingAnimationTimer = window.setTimeout(mainAnimationLoop, 500);
                }
            };

            typeStep();
        };

        const mainAnimationLoop = () => {
            const state = this.typingAnimationState;
            const currentCommand = state.commands[state.currentIndex];

            if (state.isTyping) {
                // Typing phase
                if (state.currentText.length < currentCommand.length) {
                    state.currentText = currentCommand.substring(0, state.currentText.length + 1);
                    textarea.value = prefix + state.currentText;
                    textarea.addClass('oa-text-normal');
                } else {
                    // Finished typing, wait a bit then start deleting
                    state.isTyping = false;
                    this.typingAnimationTimer = window.setTimeout(mainAnimationLoop, 1500);
                    return;
                }
            } else {
                // Deleting phase (only delete command text, keep prefix)
                if (state.currentText.length > 0) {
                    state.currentText = state.currentText.substring(0, state.currentText.length - 1);
                    textarea.value = prefix + state.currentText;
                    textarea.addClass('oa-text-normal');
                } else {
                    // Finished deleting, move to next command
                    state.isTyping = true;
                    state.currentIndex = (state.currentIndex + 1) % state.commands.length;
                    this.typingAnimationTimer = window.setTimeout(mainAnimationLoop, 500);
                    return;
                }
            }

            // Continue animation
            const delay = state.isTyping ? 80 : 50; // Typing slower than deleting
            this.typingAnimationTimer = window.setTimeout(mainAnimationLoop, delay);
        };

        // Wait 10 seconds, then erase placeholder, then type prefix, then start main loop
        this.typingAnimationTimer = window.setTimeout(erasePlaceholder, 10000);
    }

    /**
     * Stop typing animation
     */
    private stopTypingAnimation(): void {
        // Mark animation as stopped
        this.typingAnimationRunning = false;

        if (this.typingAnimationTimer !== null) {
            window.clearTimeout(this.typingAnimationTimer);
            this.typingAnimationTimer = null;
        }

        // Clear textarea animation text and restore placeholder
        const textarea = this.deps.getTextareaEl();
        if (textarea) {
            // Clear any animation text (check for prefix "In " to catch all states)
            if (textarea.value.startsWith('In ')) {
                textarea.value = '';
                // Also emit event to clear from Store
                Actions.clearTextareaContent(this.store, this.store.getState().ui.currentTab);
            }
            // Restore original placeholder and color
            textarea.setAttribute('placeholder', 'Write a command for AI...');
            textarea.removeClass('oa-text-normal'); // Reset to default color
        }
    }

    /**
     * Check if banner is shown
     */
    isErrorShown(): boolean {
        return this.isShown;
    }

    /**
     * Cleanup
     */
    cleanup(): void {
        this.stopTypingAnimation();
        if (this.bannerEl) {
            this.bannerEl.remove();
            this.bannerEl = null;
        }
        this.isShown = false;
    }
}
