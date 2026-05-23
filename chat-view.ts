import { ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import type OllamaAssistantPlugin from './main';
import { CHAT_VIEW_TYPE, type QueuedRequest, type TabState } from './chat-view/types';
import { MessageRenderer, type MessageRendererDeps } from './chat-view/components/message-renderer';
import type { EditPosition } from './chat-view/state/types';
import { RequestOrchestrator } from './chat-view/services/request-orchestrator';
import { createRequestProcessorContext } from './chat-view/services/request-context-factory';
import { NoteService } from './chat-view/services/note-service';

// NEW: Event-Driven architecture (incremental migration)
import { EventBus, type EventMap } from './chat-view/core/event-bus';
import { Store } from './chat-view/core/store';
import { Actions } from './chat-view/core/actions';
import { SpeedIndicator } from './chat-view/components/speed-indicator';
import { HistoryCounter } from './chat-view/components/history-counter';
import { BufferIndicator } from './chat-view/components/buffer-indicator';
import { ConnectionIndicator } from './chat-view/components/connection-indicator';
import { ModelIndicator } from './chat-view/components/model-indicator';
import { WebSearchIndicator } from './chat-view/components/web-search-indicator';
import { ErrorBanner } from './chat-view/components/error-banner';
import { HistoryService } from './chat-view/services/history-service';
import { ContextService } from './chat-view/services/context-service';
import { ConnectionService } from './chat-view/services/connection-service';
import { DragDropService } from './chat-view/services/dragdrop-service';
import { QuickEditsService } from './chat-view/services/quick-edits-service';
import { ModelMenuService } from './chat-view/services/model-menu-service';
import { StatusBarService } from './chat-view/services/status-bar-service';
import { ModeSwitcherService } from './chat-view/services/mode-switcher-service';
import { InputAreaService } from './chat-view/services/input-area-service';

// Re-export for backwards compatibility
export { CHAT_VIEW_TYPE };

export class OllamaChatView extends ItemView {
    plugin: OllamaAssistantPlugin;

    // NEW: Event-Driven infrastructure (incremental migration)
    eventBus: EventBus; // Public for access from main.ts (settings)
    private store: Store;

    // NEW: Event-Driven components
    private speedIndicator: SpeedIndicator;
    private historyCounter: HistoryCounter;
    private bufferIndicator: BufferIndicator;
    private connectionIndicator: ConnectionIndicator;
    private modelIndicator: ModelIndicator;
    private webSearchIndicator: WebSearchIndicator;
    private connectionService: ConnectionService | null = null;
    private dragDropService: DragDropService | null = null;
    private quickEditsService: QuickEditsService = new QuickEditsService();
    private modelMenuService!: ModelMenuService;
    private statusBarService: StatusBarService = new StatusBarService();
    private modeSwitcherService: ModeSwitcherService = new ModeSwitcherService();
    private inputAreaService!: InputAreaService;

    // Message renderer module
    private messageRenderer: MessageRenderer;

    // Event-driven history service
    private historyService: HistoryService;

    private noteService: NoteService;

    // Request orchestrator module (replaces RequestProcessor)
    private requestOrchestrator: RequestOrchestrator;

    // Context service module
    private contextService: ContextService;

    // NEW: Event-Driven error banner
    private errorBanner!: ErrorBanner; // Initialized after EventBus/Store

    // NEW: Unified tab state structure
    private tabStates: {
        edit: TabState;
        discuss: TabState;
        web: TabState;
    };

    // OLD VARIABLES REMOVED - now using tabStates structure
    // All state is now in: this.tabStates.edit/discuss/web

    // Edit counter for numbering edits
    editCounter: number = 0;
    
    // Map to store edit content by number
    editContextMap: Map<number, string> = new Map();
    
    // Map to store original position for each edit
    editPositionMap: Map<number, EditPosition> = new Map();
    
    // Current edit number being processed
    currentEditNumber: number = 0;
    sendButtonEl: HTMLButtonElement | null = null;
    modelButtonEl: HTMLButtonElement | null = null;
    quickEditsButtonEl: HTMLButtonElement | null = null;
    textareaEl: HTMLTextAreaElement | null = null;
    addContextButtonEl: HTMLButtonElement | null = null;
    contextPinButtonEl: HTMLButtonElement | null = null;
    contextCloseButtonEl: HTMLButtonElement | null = null;
    contextTopSectionEl: HTMLElement | null = null;
    inputDividerEl: HTMLElement | null = null;
    inputContainerEl: HTMLElement | null = null;
    chatMessagesWrapperEl: HTMLElement | null = null;
    chatContainerEl: HTMLElement | null = null;
    chatBlockWrapperEl: HTMLElement | null = null;
    modeSwitcherEl: HTMLElement | null = null;

    isProcessing: boolean = false;
    currentTab: 'edit' | 'discuss' | 'web' = 'edit'; // Current active tab
    processingTab: 'edit' | 'discuss' | 'web' | null = null; // Tab that is currently generating
    requestQueue: QueuedRequest[] = []; // Queue of pending requests

    // Throttling for streaming updates (prevents lag with fast cloud models)
    private streamingThrottleTimer: number | null = null;
    private pendingStreamingUpdate: { messageEl: HTMLElement; content: string } | null = null;
    private readonly STREAMING_THROTTLE_MS = 30; // Update UI max once per 30ms for cloud models

    currentAbortController: AbortController | null = null;
    silentAbort: boolean = false; // Flag to suppress "Generation stopped" when clearing history
    currentGenerationSpeed: number = 0; // tokens per second
    generationTokenCount: number = 0;
    // Connection + tool-support live in Store.ui now; ChatView should not keep legacy mirror flags.
    private lastKnownModel: string = ''; // Track last model to avoid spurious model:changed events
    private lastKnownConnectionState: boolean | null = null; // Used by ConnectionService to emit only on change
    resizeObserver: ResizeObserver | null = null;
    private messageIdCounter: number = 0; // Counter for generating unique message IDs

    // Generate unique ID for messages to reliably match DOM with history
    private generateMessageId(): string {
        return `msg-${Date.now()}-${this.messageIdCounter++}`;
    }

    constructor(leaf: WorkspaceLeaf, plugin: OllamaAssistantPlugin) {
        super(leaf);
        this.plugin = plugin;

        // NEW: Initialize Event-Driven infrastructure FIRST
        console.debug('[OllamaAssistant] Initializing Event-Driven architecture...');
        this.eventBus = new EventBus();
        this.store = new Store();

        // Enable debug mode for development (set to false in production)
        this.eventBus.setDebugMode(false);
        this.store.setDebugMode(false);

        // NEW: Initialize tab states
        this.tabStates = {
            edit: {
                turns: [],
                selectedText: '',
                selectedTextStart: 0,
                selectedTextEnd: 0,
                textareaContent: '',
                reasoningBlockEl: null,
                isCalculating: false,
                isContextPinned: false,
                lastPromptTokens: 0,
                lastResponseTokens: 0,
                scrollPosition: -1
            },
            discuss: {
                turns: [],
                selectedText: '',
                selectedTextStart: 0,
                selectedTextEnd: 0,
                textareaContent: '',
                reasoningBlockEl: null,
                isCalculating: false,
                isContextPinned: false,
                lastPromptTokens: 0,
                lastResponseTokens: 0,
                scrollPosition: -1
            },
            web: {
                turns: [],
                selectedText: '',
                selectedTextStart: 0,
                selectedTextEnd: 0,
                textareaContent: '',
                reasoningBlockEl: null,
                isCalculating: false,
                isContextPinned: false,
                lastPromptTokens: 0,
                lastResponseTokens: 0,
                scrollPosition: -1
            }
        };

        // Initialize MessageRenderer adapter
        const rendererDeps: MessageRendererDeps = {
            getMessagesContainer: () => this.getChatMessagesContainer(),
            getCurrentTab: () => this.currentTab,
            scrollToBottom: () => this.scrollToBottom(),
            generateMessageId: () => this.generateMessageId(),
            getCurrentEditNumber: () => this.currentEditNumber,
            setCurrentEditNumber: (value: number) => {
                this.currentEditNumber = value;
            },
            getEditPositionMap: () => this.editPositionMap,
            setEditPosition: (editNumber, position) => {
                this.editPositionMap.set(editNumber, position);
                Actions.setEditPosition(this.store, editNumber, position);
            },
            readActiveFile: async () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    return await this.app.vault.cachedRead(activeFile);
                }
                return null;
            },
            getTabState: (mode) => this.tabStates[mode],
            syncTurnsToStore: (mode) => this.syncTurnsToStore(mode)
        };
        this.messageRenderer = new MessageRenderer(
            rendererDeps,
            this.eventBus,
            (el, text) => this.contextService.attachUserContextTooltip(el, text)
        );

        this.historyService = new HistoryService({
            plugin: this.plugin,
            eventBus: this.eventBus,
            store: this.store,
            getTabStates: () => this.tabStates,
            getEditCounter: () => this.editCounter,
            setEditCounter: (value) => { this.editCounter = value; },
            getCurrentTab: () => this.currentTab,
            filterMessagesByMode: (skipScroll?: boolean) => this.filterMessagesByMode(skipScroll),
            // Edit positions and chains for persistence
            getEditPositionMap: () => this.editPositionMap,
            getEditChains: () => this.store.getState().edits.chains,
            setEditPosition: (editNumber, position) => {
                this.editPositionMap.set(editNumber, position);
                Actions.setEditPosition(this.store, editNumber, position);
            },
            setEditChain: (editNumber, chain) => {
                Actions.setEditChain(this.store, editNumber, chain);
            },
            clearEditPositions: () => {
                this.editPositionMap.clear();
                Actions.clearEditPositions(this.store);
            },
            clearEditChains: () => {
                Actions.clearEditChains(this.store);
            },
            getChatMessagesContainer: () => this.getChatMessagesContainer(),
            findChatElements: (selector: string) => this.findChatElements(selector)
        });

        // Event-driven NoteService listens to apply/applyWithHistory events
        this.noteService = new NoteService(
            this.app,
            this.eventBus,
            this.store,
            () => this.editPositionMap,
            (event) => this.registerEvent(event)
        );

        // Handle Add to Context from renderer buttons (EventBus)
        this.eventBus.on('edit:addToContext', (data: { content: string; editNumber: number }) => {
            this.addToContext(data.content, data.editNumber);
        });

        // Initialize RequestOrchestrator with request context (no view-as-context)
        this.requestOrchestrator = new RequestOrchestrator(
            createRequestProcessorContext({
                plugin: this.plugin,
                app: this.app,

                getCurrentTab: () => this.currentTab,
                getTabState: (mode) => this.getTabState(mode),
                getCurrentTabState: () => this.getCurrentTabState(),
                getTabStates: () => this.tabStates,

                getIsProcessing: () => this.isProcessing,
                setProcessing: (value) => {
                    this.isProcessing = value;
                },
                setProcessingTab: (tab) => {
                    this.processingTab = tab;
                },

                getRequestQueue: () => this.requestQueue,
                setRequestQueue: (queue) => {
                    this.requestQueue = queue;
                },

                setCurrentAbortController: (controller) => {
                    this.currentAbortController = controller;
                },

                isSilentAbort: () => this.silentAbort,
                setSilentAbort: (value) => {
                    this.silentAbort = value;
                },

                getEditCounter: () => this.editCounter,
                setEditCounter: (value) => {
                    this.editCounter = value;
                },
                getCurrentEditNumber: () => this.currentEditNumber,
                setCurrentEditNumber: (value) => {
                    this.currentEditNumber = value;
                },
                setEditPosition: (editNumber, position: EditPosition) => {
                    this.editPositionMap.set(editNumber, position);
                },

                getGenerationTokenCount: () => this.generationTokenCount,
                setGenerationTokenCount: (value) => {
                    this.generationTokenCount = value;
                },
                getCurrentGenerationSpeed: () => this.currentGenerationSpeed,
                setCurrentGenerationSpeed: (value) => {
                    this.currentGenerationSpeed = value;
                },

                updateSendButtonState: (processing) => this.updateSendButtonState(processing),
                updateTabIndicators: () => this.updateTabIndicators(),
                scrollToBottom: (force) => this.scrollToBottom(force),
                clearSelectedText: () => this.contextService?.clearSelectedText?.(),

                getChatMessagesContainer: () => this.getChatMessagesContainer(),
                findChatMessageElementById: (messageId) => this.findChatMessageElementById(messageId),
                findChatElements: (selector) => this.findChatElements(selector),
                findReasoningBlockElement: (mode, turnId) => this.findReasoningBlockElement(mode, turnId),
                removeAllCursorsInMode: (mode) => this.removeAllCursorsInMode(mode),
                removeAllStreamingMessages: (mode) => this.removeAllStreamingMessages(mode),
                findAbortInsertAnchor: (mode, isWebMode) => this.findAbortInsertAnchor(mode, isWebMode),
                getReasoningUiDataForMessage: (messageId, mode) => this.getReasoningUiDataForMessage(messageId, mode),
                captureMessageRendered: (messageId, mode, uiData) => this.captureMessageRendered(messageId, mode, uiData),

                clearStreamingThrottle: () => this.clearStreamingThrottle(),
                generateMessageId: () => this.generateMessageId(),
                saveChatHistory: () => this.saveChatHistory(),

                eventBus: this.eventBus,
                store: this.store
            }),
            this.eventBus
        );

        // Initialize ContextService
        this.contextService = new ContextService({
            app: this.app,
            getCurrentTabState: () => this.getCurrentTabState(),
            getTabState: (mode) => this.getTabState(mode),
            getCurrentTab: () => this.currentTab,
            getComponent: () => this
        });

        this.modelMenuService = new ModelMenuService({
            plugin: this.plugin,
            eventBus: this.eventBus,
            refreshConnectionAndTools: () => this.refreshConnectionAndTools(),
            getModelButtonEl: () => this.modelButtonEl
        });
        this.inputAreaService = new InputAreaService({
            contextService: this.contextService,
            eventBus: this.eventBus,
            store: this.store,
            getBodyEl: () => document.body,
            getCurrentTab: () => this.currentTab,
            getCurrentTabState: () => this.getCurrentTabState(),
            clearTextToEdit: () => this.clearTextToEdit(),
            sendMessage: (message, textarea) => { void this.sendMessage(message, textarea); },
            updateContextVisibility: () => this.updateContextVisibility(),
            toggleModelMenu: () => { void this.toggleModelMenu(); },
            toggleQuickEditsMenu: () => this.toggleQuickEditsMenu(),
            isProcessing: () => this.isProcessing,
            getAbortController: () => this.currentAbortController,
            clearStreamingThrottle: () => this.clearStreamingThrottle(),
            setProcessing: (value: boolean) => { this.isProcessing = value; },
            setInputRefs: ({
                container,
                topSection,
                divider,
                textarea,
                sendButton,
                modelButton,
                quickEditsButton,
                addContextButton,
                contextPinButton,
                contextCloseButton
            }) => {
                this.inputContainerEl = container;
                this.contextTopSectionEl = topSection;
                this.inputDividerEl = divider;
                this.textareaEl = textarea;
                this.sendButtonEl = sendButton;
                this.modelButtonEl = modelButton;
                this.quickEditsButtonEl = quickEditsButton;
                this.addContextButtonEl = addContextButton;
                this.contextPinButtonEl = contextPinButton;
                this.contextCloseButtonEl = contextCloseButton;
            }
        });

        // NEW: Initialize Event-Driven components
        console.debug('[OllamaAssistant] Initializing Event-Driven components...');
        this.speedIndicator = new SpeedIndicator(this.eventBus);
        this.historyCounter = new HistoryCounter(this.plugin, this.eventBus, this.store);
        this.bufferIndicator = new BufferIndicator(this.plugin, this.eventBus, this.store);
        this.connectionIndicator = new ConnectionIndicator(this.eventBus, this.store);
        this.modelIndicator = new ModelIndicator(this.plugin, this.eventBus, this.store);
        this.webSearchIndicator = new WebSearchIndicator(this.eventBus, this.store);
        this.errorBanner = new ErrorBanner(this.eventBus, this.store, {
            getChatBlockWrapperEl: () => this.chatBlockWrapperEl,
            getChatContainerEl: () => this.chatContainerEl,
            getTextareaEl: () => this.textareaEl,
            getSendButtonEl: () => this.sendButtonEl,
            // Model button is .model-btn-corner in current UI
            getModelButtonEl: () => this.modelButtonEl,
            // Quick edits button is .quick-edits-btn-corner in current UI
            getQuickEditsButtonEl: () => this.quickEditsButtonEl,
            getAddContextButtonEl: () => this.addContextButtonEl,
            getContextPinButtonEl: () => this.contextPinButtonEl,
            getContextCloseButtonEl: () => this.contextCloseButtonEl,
            getInputContainerEl: () => this.inputContainerEl,
            getBodyEl: () => document.body,
            getHeadEl: () => document.head
        });
        console.debug('[OllamaAssistant] Event-Driven architecture ready!');

        // Subscribe to connection:check event to refresh connection
        this.eventBus.on('connection:check', () => {
            // Prefer ConnectionService (it centralizes debouncing/state change rules);
            // fall back to direct refresh during early startup.
            void (this.connectionService?.checkNow() ?? this.refreshConnectionAndTools());
        });
    }

    // NEW: Helper methods for accessing tab state
    private getCurrentTabState(): TabState {
        return this.tabStates[this.currentTab];
    }

    private getTabState(mode: 'edit' | 'discuss' | 'web'): TabState {
        return this.tabStates[mode];
    }

    private syncTurnsToStore(mode: 'edit' | 'discuss' | 'web'): void {
        const tabState = this.tabStates[mode];
        Actions.setTurns(this.store, mode, tabState.turns);
    }

    // Clear streaming throttle timer and pending update (prevents cursor from being added back after finalize)
    private clearStreamingThrottle(): void {
        if (this.streamingThrottleTimer) {
            clearTimeout(this.streamingThrottleTimer);
            this.streamingThrottleTimer = null;
        }
        this.pendingStreamingUpdate = null;
    }

    // Public API methods delegating to ContextService
    setSelectedText(text: string, isEntireNote: boolean = false) {
        this.contextService.setSelectedText(text, isEntireNote);
    }

    setSelectedTextWithOffsets(text: string, start: number, end: number) {
        this.contextService.setSelectedTextWithOffsets(text, start, end, false);
    }

    clearSelectedText() {
        this.contextService.clearSelectedText();
    }

    clearTextToEdit() {
        this.contextService.clearSelectedText();
    }

    getViewType(): string {
        return CHAT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Ollama Assistant';
    }

    getIcon(): string {
        return 'ollama-assistant';
    }

    async onOpen() {
        // Reset processing state on view open (prevents stuck state after crash/sync)
        this.isProcessing = false;
        this.currentAbortController = null;
        this.processingTab = null;

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('ollama-chat-container');
        this.chatContainerEl = container;

        // Check if model supports Function Calling
        await this.plugin.ollamaClient.checkModelToolSupport();
        const supportsTools = this.plugin.ollamaClient.getModelSupportsTools();
        const { modelInfo } = this.statusBarService.createStatusBarArea(
            container,
            supportsTools,
            async (el) => {
                await this.updateLLMStatus(el);
            },
            {
                onClearCurrentTab: () => {
                    void this.clearCurrentTab();
                },
                onClearAllTabs: () => {
                    void this.clearAllTabs();
                }
            }
        );
        if (modelInfo) {
            modelInfo.textContent = `${this.plugin.settings.model}`;
        }

        // Chat block wrapper - combines messages window and tabs
        const chatBlock = container.createEl('div', { cls: 'chat-block-wrapper mode-edit' });
        this.chatBlockWrapperEl = chatBlock;

        // Chat messages container wrapper
        const chatMessagesWrapper = chatBlock.createEl('div', { cls: 'ollama-chat-messages-wrapper mode-edit' });
        this.chatMessagesWrapperEl = chatMessagesWrapper;

        // Chat messages area
        const chatMessages = chatMessagesWrapper.createEl('div', { cls: 'ollama-chat-messages' });
        chatMessages.id = 'ollama-chat-messages';

        // Add welcome messages for each mode
        this.eventBus.emit('render:addWelcomeMessages');
        // Filter immediately to show only current tab's welcome message
        this.filterMessagesByMode(true);

        // Stats panel in bottom-right corner (History + Load)
        const statsPanel = chatMessagesWrapper.createEl('span', { cls: 'chat-stats-panel' });
        
        const historyStatEl = statsPanel.createEl('span', { cls: 'stat-item' });
        historyStatEl.id = 'chat-history-stat';
        historyStatEl.createEl('span', { cls: 'stat-label', text: 'History:' });
        historyStatEl.createEl('span', { cls: 'stat-value', text: '0' });
        
        statsPanel.createEl('span', { cls: 'stat-divider' });
        
        const loadStatEl = statsPanel.createEl('span', { cls: 'stat-item' });
        loadStatEl.id = 'chat-load-stat';
        loadStatEl.createEl('span', { cls: 'stat-label', text: 'Buffer:' });
        const bufferInitialText = 'Idle';
        loadStatEl.createEl('span', { cls: 'stat-value', text: bufferInitialText });

        // Info icon for buffer tooltip (hidden by default, shown when there's data)
        loadStatEl.createEl('span', {
            cls: 'buffer-info-icon oa-hidden',
            text: 'ⓘ',
            attr: { id: 'buffer-info' }
        });

        // Mode switcher (BELOW chat window - folder tabs at bottom)
        const modeSwitcher = chatBlock.createEl('div', { cls: 'mode-switcher' });
        this.modeSwitcherEl = modeSwitcher;
        this.modeSwitcherService.create(modeSwitcher, supportsTools, (mode) => this.switchMode(mode));

        // ResizeObserver to detect narrow width and apply compact mode
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                if (width <= 250) {
                    container.addClass('compact-mode');
                    // Also add compact-mode to error banner if it exists
                    this.errorBanner?.setCompactMode(true);
                } else {
                    container.removeClass('compact-mode');
                    // Also remove compact-mode from error banner if it exists
                    this.errorBanner?.setCompactMode(false);
                }
            }
        });
        this.resizeObserver.observe(container);

        // Input area (NEW design: border + background + context inside + send inside)
        this.inputAreaService.createInputArea(container, supportsTools);

        // Connection service (event-driven)
        this.connectionService = new ConnectionService({
            app: this.app,
            eventBus: this.eventBus,
            store: this.store,
            refreshConnectionAndTools: () => this.refreshConnectionAndTools(),
            getLastKnownConnectionState: () => this.lastKnownConnectionState,
            setLastKnownConnectionState: (state) => { this.lastKnownConnectionState = state; }
        });
        await this.connectionService.start(3000);

        // Drag and drop service (event-driven)
        this.dragDropService = new DragDropService({
            eventBus: this.eventBus,
            store: this.store,
            contextService: this.contextService,
            getInputContainerEl: () => this.inputContainerEl,
            getTextareaEl: () => this.textareaEl
        });
        this.dragDropService.start();

        // Apply initial filter for current mode
        this.filterMessagesByMode();

        // Load saved chat history from settings
        this.loadChatHistory();

        // On startup, first entry to each tab should open at the bottom.
        this.initializeTabScrollPositions();
        this.restoreCurrentTabScrollPosition();

        // Update context preview (shows/hides +Add button)
        this.contextService.updateSelectedTextPreview();

        // NEW: Emit app:ready event for Event-Driven components
        console.debug('[OllamaAssistant] UI initialized, emitting app:ready event...');
        this.eventBus.emit('app:ready');
    }

    switchMode(mode: 'edit' | 'discuss' | 'web', skipScroll: boolean = false) {
        // Allow switching even during generation
        this.clearStreamingThrottle();

        // Save current textarea content before switching (but NOT if animation is running)
        const textarea = this.textareaEl;
        if (textarea && !this.errorBanner?.isTypingAnimationRunning()) {
            this.getCurrentTabState().textareaContent = textarea.value;
        }

        // Save scroll position for current tab before switching
        const messagesContainer = document.getElementById('ollama-chat-messages');
        if (messagesContainer) {
            this.getCurrentTabState().scrollPosition = messagesContainer.scrollTop;
        }

        const oldTab = this.currentTab;
        this.currentTab = mode;
        Actions.switchMode(this.store, mode);

        // Emit mode switch event for Event-Driven components
        this.eventBus.emit('mode:switched', { from: oldTab, to: mode });

        // Save the active tab to settings
        this.plugin.settings.lastActiveTab = mode;
        void this.plugin.saveSettings();

        // Restore textarea content for new mode (or keep animation if Ollama is offline)
        if (textarea) {
            // If animation is running, keep it (don't restore saved content)
            if (!this.errorBanner?.isTypingAnimationRunning()) {
                textarea.value = this.getCurrentTabState().textareaContent;
            }
            // No need to adjust height - fixed max-height with scrollbar
        }

        const editBtn = document.getElementById('mode-edit-btn');
        const discussBtn = document.getElementById('mode-discuss-btn');
        const webBtn = document.getElementById('mode-web-btn');

        if (editBtn && discussBtn) {
            editBtn.removeClass('mode-btn-active');
            discussBtn.removeClass('mode-btn-active');
            editBtn.setAttribute('aria-selected', 'false');
            discussBtn.setAttribute('aria-selected', 'false');
            editBtn.setAttribute('tabindex', '-1');
            discussBtn.setAttribute('tabindex', '-1');
            if (webBtn) {
                webBtn.removeClass('mode-btn-active');
                webBtn.setAttribute('aria-selected', 'false');
                webBtn.setAttribute('tabindex', '-1');
            }

            let activeBtn: HTMLElement | null = null;
            if (mode === 'edit') {
                activeBtn = editBtn;
            } else if (mode === 'discuss') {
                activeBtn = discussBtn;
            } else if (mode === 'web' && webBtn) {
                activeBtn = webBtn;
            }

            if (activeBtn) {
                activeBtn.addClass('mode-btn-active');
                activeBtn.setAttribute('aria-selected', 'true');
                activeBtn.setAttribute('tabindex', '0');
            }
        }

        // Update wrapper class for mode-specific styling
        if (this.chatMessagesWrapperEl) {
            this.chatMessagesWrapperEl.removeClass('mode-edit', 'mode-discuss', 'mode-web');
            this.chatMessagesWrapperEl.addClass(`mode-${mode}`);
        }

        if (this.chatBlockWrapperEl) {
            this.chatBlockWrapperEl.removeClass('mode-edit', 'mode-discuss', 'mode-web');
            this.chatBlockWrapperEl.addClass(`mode-${mode}`);
        }

        // Update input container class for mode-specific styling (e.g., Prompts button)
        if (this.inputContainerEl) {
            this.inputContainerEl.removeClass('mode-edit', 'mode-discuss', 'mode-web');
            this.inputContainerEl.addClass(`mode-${mode}`);
        }

        // Show/hide messages based on mode instead of redrawing
        this.filterMessagesByMode(true); // Always skip auto-scroll, we handle it below
        this.updateContextVisibility();

        // Restore scroll position for new tab (or scroll to bottom if generating on this tab)
        if (messagesContainer) {
            this.restoreCurrentTabScrollPosition();
        }

        // Update context preview for new mode
        this.contextService.updateSelectedTextPreview();

        // Update stats for new mode
        // DISABLED: HistoryCounter and BufferIndicator handle this now
        // this.statusManager.updateHistoryStat();
        // this.statusManager.updateBufferStat();
    }

    updateContextVisibility() {
        const isWeb = this.currentTab === 'web'; // NEW: using currentTab
        const addContextButton = this.addContextButtonEl;
        const contextPin = this.contextPinButtonEl;

        if (this.contextTopSectionEl) {
            this.contextTopSectionEl.removeClass('oa-hidden');
        }
        if (this.inputDividerEl) {
            this.inputDividerEl.removeClass('oa-hidden');
        }

        // Hide +Add button and pin button in Web mode (no context support)
        // In other modes, visibility is controlled by updateSelectedTextPreview()
        if (isWeb) {
            if (addContextButton) {
                addContextButton.addClass('oa-hidden');
            }
            if (contextPin) {
                contextPin.addClass('oa-hidden');
            }
        }

        // No longer needed - default is "No context" for all modes
    }

    filterMessagesByMode(skipScroll: boolean = false) {
        const messagesContainer = document.getElementById('ollama-chat-messages');
        if (!messagesContainer) return;

        const allMessages = messagesContainer.querySelectorAll('.chat-message');
        const allReasoningBlocks = messagesContainer.querySelectorAll('.reasoning-block');
        const allTurns = messagesContainer.querySelectorAll('.turn-container');

        allMessages.forEach((msg: HTMLElement) => {
            const msgMode = msg.getAttribute('data-mode');
            msg.toggleClass('oa-hidden', msgMode !== this.currentTab);
        });

        // Filter reasoning blocks with same logic
        allReasoningBlocks.forEach((block: HTMLElement) => {
            const blockMode = block.getAttribute('data-mode');
            block.toggleClass('oa-hidden', blockMode !== this.currentTab);
        });

        // Ensure turn containers follow the active mode visibility
        allTurns.forEach((turn: HTMLElement) => {
            const turnMode = turn.getAttribute('data-mode');
            turn.toggleClass('oa-hidden', turnMode !== this.currentTab);
        });

        if (!skipScroll) {
            this.scrollToBottom();
        }
        this.updateContextVisibility();
    }

    async updateLLMStatus(statusEl: HTMLElement) {
        const isConnected = await this.plugin.ollamaClient.checkConnection();
        statusEl.empty();
        const dot = statusEl.createSpan();
        dot.toggleClass('oa-dot-connected', isConnected);
        dot.toggleClass('oa-dot-disconnected', !isConnected);
        dot.textContent = '●';
        statusEl.appendText(isConnected ? ' Connected' : ' Disconnected');
    }

    /**
     * Refresh connection status and tool support, update store and emit events
     */
    private async refreshConnectionAndTools() {
        let connected = await this.plugin.ollamaClient.checkConnection();
        let supportsTools = false;

        // If connected, check if any models exist
        if (connected) {
            try {
                const models = await this.plugin.ollamaClient.listModels();
                if (models.length === 0) {
                    // No models installed - treat as disconnected for banner purposes
                    connected = false;
                } else {
                    // Auto-select model if none selected or current model doesn't exist
                    const currentModel = this.plugin.settings.model;
                    if (!currentModel || !models.includes(currentModel)) {
                        this.plugin.settings.model = models[0];
                        await this.plugin.saveSettings();
                        this.plugin.ollamaClient.updateSettings(this.plugin.settings);
                    }
                }
            } catch {
                // Failed to get models list
                connected = false;
            }
        }

        if (connected) {
            supportsTools = await this.plugin.ollamaClient.checkModelToolSupport();
        }

        // Update Store UI flags (so indicators update)
        this.store.setState(state => ({
            ...state,
            ui: {
                ...state.ui,
                isConnected: connected,
                currentModelSupportsTools: supportsTools
            }
        }));

        // Update mode switcher (show/hide Web tab)
        this.modeSwitcherService?.update(supportsTools, (mode) => this.switchMode(mode));

        // If Web tab disappears while user is on it, move them to Edit
        if (!supportsTools && this.currentTab === 'web') {
            this.switchMode('edit', true);
        }

        // Only emit model:changed when model actually changed (prevents spurious Idle resets)
        const currentModel = this.plugin.settings.model;
        if (currentModel !== this.lastKnownModel) {
            this.lastKnownModel = currentModel;
            this.eventBus.emit('model:changed', { model: currentModel });
        }
        // connection:changed is emitted by ConnectionService only when state changes.
    }

    updateTabIndicators() {
        const modeSwitcher = this.modeSwitcherEl;
        if (!modeSwitcher) return;
        const queuedModes = new Set(this.requestQueue.map(req => req.mode));
        this.modeSwitcherService.updateIndicators(modeSwitcher, this.processingTab, queuedModes);
    }

    updateSendButtonState(processing: boolean) {
        const btn = this.sendButtonEl;
        if (!btn) return;
        const iconEl = btn.querySelector('.send-btn-icon');
        const textEl = btn.querySelector('.send-btn-text');

        if (processing) {
            btn.addClass('stop-mode');
            if (iconEl) setIcon(iconEl as HTMLElement, 'square');
            if (textEl) textEl.textContent = 'Stop';
        } else {
            btn.removeClass('stop-mode');
            if (iconEl) setIcon(iconEl as HTMLElement, 'corner-down-left'); // enter-like icon
            if (textEl) textEl.textContent = 'Send';
        }
    }

    async sendMessage(message: string, textarea: HTMLTextAreaElement | null) {
        await this.requestOrchestrator.sendMessage(message, textarea);
    }

    addToContext(content: string, editNumber: number) {
        // Set the edited content as selected text (like "Add to Ollama Assistant")
        const editTabState = this.getTabState('edit');
        editTabState.selectedText = content;
        editTabState.isContextPinned = false; // Reset pin state when adding new context

        // Set custom label for context display
        editTabState.contextLabel = `Edit ${editNumber}`;

        // Keep the original position from the edit we're adding to context
        // This way, the next edit will remember where the original text came from
        const originalPosition = this.editPositionMap.get(editNumber);
        if (originalPosition) {
            editTabState.selectedTextStart = originalPosition.start;
            editTabState.selectedTextEnd = originalPosition.end;
        } else {
            // Fallback: treat as whole note
            editTabState.selectedTextStart = 0;
            editTabState.selectedTextEnd = 0;
        }

        // Store the actual content mapped to the edit number
        this.editContextMap.set(editNumber, content);

        // Switch to edit tab to display the newly added context (skip scroll)
        this.switchMode('edit', true);

        // Update UI using standard preview update
        this.contextService.updateSelectedTextPreview();

        new Notice(`Edit ${editNumber} added to context`);
    }

    scrollToBottom(force: boolean = false) {
        // Only auto-scroll if generation is happening on the current tab (unless forced)
        if (!force && this.processingTab && this.processingTab !== this.currentTab) {
            return;
        }

        const messagesContainer = document.getElementById('ollama-chat-messages');
        if (messagesContainer) {
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 10);
        }
    }

    private initializeTabScrollPositions() {
        const modes: ('edit' | 'discuss' | 'web')[] = ['edit', 'discuss', 'web'];
        modes.forEach((mode) => {
            const tabState = this.getTabState(mode);
            tabState.scrollPosition = tabState.turns.length > 0 ? -1 : 0;
        });
    }

    private restoreCurrentTabScrollPosition() {
        const messagesContainer = this.getChatMessagesContainer();
        if (!messagesContainer) return;

        if (this.processingTab === this.currentTab) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            return;
        }

        const tabState = this.getCurrentTabState();
        if (tabState.scrollPosition < 0) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            tabState.scrollPosition = messagesContainer.scrollTop;
            return;
        }

        messagesContainer.scrollTop = tabState.scrollPosition;
    }

    // === UI ports (DOM helpers) ===
    // These methods intentionally keep DOM access inside ChatView (composition root),
    // so services/handlers can stay event-driven and avoid calling document.* directly.

    getChatMessagesContainer(): HTMLElement | null {
        return document.getElementById('ollama-chat-messages');
    }

    findChatMessageElementById(messageId: string): HTMLElement | null {
        const container = this.getChatMessagesContainer();
        if (!container) return null;
        return container.querySelector(`[data-msg-id="${messageId}"]`);
    }

    findChatElements(selector: string): HTMLElement[] {
        const container = this.getChatMessagesContainer();
        if (!container) return [];
        return Array.from(container.querySelectorAll(selector));
    }

    findReasoningBlockElement(mode: 'edit' | 'discuss' | 'web', turnId?: string): HTMLElement | null {
        const container = this.getChatMessagesContainer();
        if (!container) return null;
        const blocks = Array.from(container.querySelectorAll(`.reasoning-block[data-mode="${mode}"]`));
        if (blocks.length === 0) return null;

        if (turnId) {
            const match = blocks.filter((el) => el.getAttribute('data-turn-id') === turnId);
            if (match.length > 0) {
                return match[match.length - 1] as HTMLElement;
            }
            return null;
        }

        return blocks[blocks.length - 1] as HTMLElement;
    }

    removeAllCursorsInMode(mode: 'edit' | 'discuss' | 'web'): void {
        const streamingMessages = this.findChatElements(`.streaming-message[data-mode="${mode}"]`);
        streamingMessages.forEach((msgEl) => {
            const cursor = msgEl.querySelector('.cursor-blink');
            if (cursor) cursor.remove();
        });

        const reasoningBlocks = this.findChatElements(`.reasoning-block[data-mode="${mode}"]`);
        reasoningBlocks.forEach((blockEl) => {
            const cursor = blockEl.querySelector('.cursor-blink');
            if (cursor) cursor.remove();
        });
    }

    removeAllStreamingMessages(mode?: 'edit' | 'discuss' | 'web'): void {
        const selector = mode
            ? `.streaming-message[data-mode="${mode}"]`
            : `.streaming-message`;
        this.findChatElements(selector).forEach((el) => el.remove());
    }

    /**
     * Used by abort handling to locate a safe insertion anchor without services touching DOM.
     */
    findAbortInsertAnchor(mode: 'edit' | 'discuss' | 'web', isWebMode: boolean): HTMLElement | null {
        let lastStreamingMessage: HTMLElement | null = null;

        if (isWebMode) {
            const container = this.getChatMessagesContainer();
            if (container) {
                const userMessages = Array.from(container.querySelectorAll(`.user-message[data-mode="${mode}"]`));
                const activeUserMsg = userMessages.reverse().find(msg => !msg.querySelector('.queued-status')) as HTMLElement | undefined;

                if (activeUserMsg) {
                    let nextEl = activeUserMsg.nextElementSibling as HTMLElement | null;
                    while (nextEl) {
                        if (nextEl.getAttribute('data-mode') === mode && !nextEl.classList.contains('user-message')) {
                            lastStreamingMessage = nextEl;
                        } else if (nextEl.classList.contains('user-message')) {
                            break;
                        }
                        nextEl = nextEl.nextElementSibling as HTMLElement | null;
                    }
                    if (!lastStreamingMessage) {
                        lastStreamingMessage = activeUserMsg;
                    }
                }
            }
        }

        if (lastStreamingMessage) return lastStreamingMessage;

        // Fallback: last element in mode
        const container = this.getChatMessagesContainer();
        if (!container) return null;
        const lastInMode = Array.from(
            container.querySelectorAll(`.chat-message[data-mode="${mode}"], .reasoning-block[data-mode="${mode}"]`)
        ).pop() as HTMLElement | undefined;
        return lastInMode ?? null;
    }

    /**
     * Pull finalized reasoning data (if present) for history capture.
     */
    getReasoningUiDataForMessage(
        messageId: string,
        mode: 'edit' | 'discuss' | 'web'
    ): { reasoningHtml?: string; reasoningCollapsed?: boolean } | null {
        const messageEl = this.findChatMessageElementById(messageId);
        if (!messageEl) return null;

        let currentEl = messageEl.previousElementSibling as HTMLElement | null;
        while (currentEl) {
            if (currentEl.classList.contains('reasoning-block')) {
                if (currentEl.getAttribute('data-mode') === mode) {
                    const reasoningData = currentEl._finalizedReasoningData;
                    if (reasoningData) {
                        return { reasoningHtml: reasoningData.html, reasoningCollapsed: reasoningData.collapsed };
                    }
                    return {
                        reasoningHtml: currentEl.innerHTML,
                        reasoningCollapsed: currentEl.classList.contains('collapsed')
                    };
                }
                break;
            }
            if (currentEl.classList.contains('user-message')) break;
            if (currentEl.classList.contains('assistant-message') && !currentEl.classList.contains('system-message')) break;
            currentEl = currentEl.previousElementSibling as HTMLElement | null;
        }

        return null;
    }

    captureMessageRendered(
        messageId: string,
        mode: 'edit' | 'discuss' | 'web',
        uiData: EventMap['message:rendered']['uiData']
    ): void {
        const el = this.findChatMessageElementById(messageId);
        if (!el) return;
        this.eventBus.emit('message:rendered', {
            messageId,
            mode,
            uiData: {
                html: el.innerHTML,
                classes: el.className,
                ...uiData
            }
        });
    }

    async toggleModelMenu() {
        const existingMenu = document.querySelector<HTMLElement>('.model-selector-menu');
        await this.modelMenuService.toggleModelMenu(existingMenu);
    }

    toggleQuickEditsMenu() {
        this.quickEditsService.toggleQuickEditsMenu(this.quickEditsButtonEl, this.textareaEl, document.body);
    }

    // Load saved chat history from settings
    private loadChatHistory() {
        console.debug('[OllamaAssistant] Loading chat history (turn-based)...');
        const savedTab = this.historyService.loadHistory();
        if (savedTab) {
            console.debug('[OllamaHelper] Restoring last active tab:', savedTab);

            // Check if the saved tab is valid
            let tabToRestore: 'edit' | 'discuss' | 'web' = savedTab;

            // For web tab, check if it exists (model supports tools)
            if (savedTab === 'web') {
                const webBtn = document.getElementById('mode-web-btn');
                if (!webBtn) {
                    console.debug('[OllamaHelper] Web tab not available, falling back to edit');
                    tabToRestore = 'edit';
                }
            }

            // Switch to the restored tab
            if (tabToRestore !== this.currentTab) {
                this.switchMode(tabToRestore);
            }
        }
    }

    // Save current chat history to settings
    private async saveChatHistory() {
        console.debug('[OllamaHelper] Saving chat history...');
        await this.historyService.saveHistory();
        console.debug('[OllamaHelper] Chat history saved');
    }

    // Clear current tab chat history
    private async clearCurrentTab() {
        // Stop any active generation for this tab
        if (this.processingTab === this.currentTab && this.currentAbortController) {
            this.silentAbort = true; // Don't show "Generation stopped" message
            // CRITICAL: Reset isProcessing and throttle first
            this.isProcessing = false;
            this.clearStreamingThrottle();
            this.currentAbortController.abort();
            this.processingTab = null;
            this.currentAbortController = null;
            this.updateSendButtonState(false);
        }

        // Remove queued requests for this tab
        this.requestQueue = this.requestQueue.filter(req => req.mode !== this.currentTab);
        this.updateTabIndicators();

        await this.historyService.clearTab(this.currentTab, {
            resetEditCounter: this.currentTab === 'edit'
        });
        new Notice(`${this.currentTab.charAt(0).toUpperCase() + this.currentTab.slice(1)} tab cleared`);
    }

    // Clear all tabs chat history
    private async clearAllTabs() {
        // Stop any active generation
        if (this.currentAbortController) {
            this.silentAbort = true; // Don't show "Generation stopped" message
            // CRITICAL: Reset isProcessing and throttle first
            this.isProcessing = false;
            this.clearStreamingThrottle();
            this.currentAbortController.abort();
            this.processingTab = null;
            this.currentAbortController = null;
            this.updateSendButtonState(false);
        }

        // Clear entire request queue
        this.requestQueue = [];
        this.updateTabIndicators();

        await this.historyService.clearAll();
        new Notice('All chat history cleared');
    }

    async onClose() {
        // Save chat history before closing
        await this.saveChatHistory();

        // Notify event-driven parts that view is closing
        this.eventBus.emit('app:cleanup');

        // Cleanup connection check interval
        this.connectionService?.stop();

        // Cleanup drag and drop service
        this.dragDropService?.cleanup();

        // Cleanup indicators/components
        this.speedIndicator?.cleanup();
        this.historyCounter?.cleanup();
        this.bufferIndicator?.cleanup();
        this.connectionIndicator?.cleanup();
        this.modelIndicator?.cleanup();
        this.webSearchIndicator?.cleanup();

        // Cleanup resize observer and window resize handler
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        // ErrorBanner cleanup happens automatically
        this.errorBanner?.cleanup();

        // Remove add context menu from DOM
        const addContextMenu = document.getElementById('add-context-menu');
        if (addContextMenu) {
            addContextMenu.remove();
        }
    }
}

// WebSearchModal removed - web search now handled via Ollama Tools
