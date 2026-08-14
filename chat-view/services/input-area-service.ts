import type { ContextService } from './context-service';
import type { EventBus } from '../core/event-bus';
import type { TabState } from '../types';
import { Notice, setIcon } from 'obsidian';
import type { Store } from '../core/store';
import { Actions } from '../core/actions';

interface InputAreaDeps {
    contextService: ContextService;
    eventBus: EventBus;
    store: Store;
    getBodyEl: () => HTMLElement;
    getCurrentTab: () => 'edit' | 'discuss' | 'web';
    getCurrentTabState: () => TabState;
    clearTextToEdit: () => void;
    sendMessage: (message: string, textarea: HTMLTextAreaElement | null) => void;
    updateContextVisibility: () => void;
    toggleModelMenu: () => void;
    toggleQuickEditsMenu: () => void;
    isProcessing: () => boolean;
    getAbortController: () => AbortController | null;
    clearStreamingThrottle: () => void;
    setProcessing: (value: boolean) => void;
    setInputRefs: (refs: {
        container: HTMLElement;
        topSection: HTMLElement;
        divider: HTMLElement;
        textarea: HTMLTextAreaElement;
        sendButton: HTMLButtonElement;
        modelButton: HTMLButtonElement;
        quickEditsButton: HTMLButtonElement;
        addContextButton: HTMLButtonElement;
        contextPinButton: HTMLButtonElement;
        contextCloseButton: HTMLButtonElement;
    }) => void;
}

/**
 * InputAreaService - creates input/preview/context-line/pin/buttons.
 */
export class InputAreaService {
    constructor(private deps: InputAreaDeps) {}

    createInputArea(container: HTMLElement, supportsTools: boolean): HTMLElement {
        const inputContainer = container.createDiv({ cls: 'ollama-chat-input-container mode-edit' });
        inputContainer.id = 'ollama-input-container';

        // Tooltip for user message context - needed for custom tooltips
        const bodyEl = this.deps.getBodyEl();
        let userContextTooltipEl = bodyEl.querySelector<HTMLElement>('#user-context-tooltip');
        if (!userContextTooltipEl) {
            userContextTooltipEl = bodyEl.createDiv({
                cls: 'context-tooltip user-context-tooltip oa-hidden',
                attr: { id: 'user-context-tooltip' }
            });
        }

        const topSection = inputContainer.createDiv({ cls: 'input-top-section' });

        const contextLine = topSection.createDiv({ cls: 'context-line' });
        contextLine.createSpan({ cls: 'context-label', text: 'Context: ' });
        const contextValue = contextLine.createSpan({
            cls: 'context-value',
            text: 'No context',
            attr: { id: 'context-value' }
        });

        const contextInfo = contextLine.createSpan({
            cls: 'context-info-icon',
            text: 'ⓘ',
            attr: { id: 'context-info' }
        });
        this.deps.contextService.setupContextTooltip(contextInfo);

        const addContextButton = topSection.createEl('button', {
            cls: 'add-context-button',
            attr: { id: 'add-context-button' }
        });
        addContextButton.createSpan({ cls: 'add-context-icon', text: '+' });
        addContextButton.createSpan({ text: 'Add', cls: 'add-context-text' });

        let addContextMenu = bodyEl.querySelector<HTMLElement>('#add-context-menu');
        if (!addContextMenu) {
            addContextMenu = bodyEl.createDiv({
                cls: 'add-context-menu',
                attr: { id: 'add-context-menu' }
            });
        }
        addContextMenu.addClass('oa-hidden');

        const addSelectedTextBtn = addContextMenu.createDiv({
            cls: 'menu-item',
            text: 'Add selected text'
        });
        const addEntireNoteBtn = addContextMenu.createDiv({
            cls: 'menu-item',
            text: 'Add entire note'
        });
        this.deps.contextService.setupAddContextMenu(addContextButton, addContextMenu, addSelectedTextBtn, addEntireNoteBtn);

        const contextPin = inputContainer.createEl('button', {
            cls: 'context-pin oa-hidden',
            attr: { id: 'context-pin', title: 'Pin context' }
        });
        const pinSvg = contextPin.createSvg('svg', {
            attr: { width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
        });
        pinSvg.createSvg('path', { attr: { d: 'M12 17v5' } });
        pinSvg.createSvg('path', { attr: { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z' } });
        contextPin.addEventListener('click', () => {
            this.deps.contextService.togglePin(contextPin);
        });

        const contextClose = inputContainer.createEl('button', {
            cls: 'context-close',
            attr: { id: 'context-close' }
        });
        setIcon(contextClose, 'x');
        contextClose.addEventListener('click', () => {
            this.deps.clearTextToEdit();
        });

        const divider = inputContainer.createDiv({ cls: 'input-divider' });

        const bottomSection = inputContainer.createDiv({ cls: 'input-bottom-section' });

        const textarea = bottomSection.createEl('textarea', {
            cls: 'ollama-chat-input',
            attr: {
                placeholder: 'Write a command for AI...',
                rows: '3'
            }
        });

        // Model selector button (left corner)
        const modelBtn = inputContainer.createEl('button', {
            cls: 'model-btn-corner'
        });
        const modelSvg = modelBtn.createSvg('svg', {
            cls: 'btn-icon',
            attr: { width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }
        });
        modelSvg.createSvg('polygon', { attr: { points: '12 2 2 7 12 12 22 7 12 2' } });
        modelSvg.createSvg('polyline', { attr: { points: '2 17 12 22 22 17' } });
        modelSvg.createSvg('polyline', { attr: { points: '2 12 12 17 22 12' } });
        modelBtn.createSpan({ text: 'Model' });
        modelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deps.toggleModelMenu();
        });

        // Quick edits button (next to Send button, only in edit mode)
        const quickEditsBtn = inputContainer.createEl('button', {
            cls: 'quick-edits-btn-corner',
            text: 'Prompts'
        });
        quickEditsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deps.toggleQuickEditsMenu();
        });

        // Send button (corner)
        const sendBtn = inputContainer.createEl('button', {
            cls: 'send-btn-corner'
        });
        const sendIconEl = sendBtn.createSpan({ cls: 'send-btn-icon' });
        setIcon(sendIconEl, 'corner-down-left');
        sendBtn.createSpan({ cls: 'send-btn-text', text: 'Send' });

        const sendWithValidation = (allowDuringProcessing: boolean) => {
            if (this.deps.isProcessing() && !allowDuringProcessing) {
                const abort = this.deps.getAbortController();
                if (abort) {
                    this.deps.setProcessing(false);
                    this.deps.clearStreamingThrottle();
                    abort.abort();
                    new Notice('Stopping generation...');
                }
                return;
            }
            const text = textarea.value.trim();
            if (!text) return;
            if (this.deps.getCurrentTab() === 'edit') {
                const tabState = this.deps.getCurrentTabState();
                if (!tabState.selectedText && !tabState.isContextPinned) {
                    new Notice('Please select text to edit or add context');
                    return;
                }
            }
            this.deps.sendMessage(textarea.value, textarea);
        };

        sendBtn.addEventListener('click', () => {
            sendWithValidation(false);
        });

        textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendWithValidation(true); // allow queueing while processing
            }
        });

        textarea.addEventListener('input', () => {
            const tabState = this.deps.getCurrentTabState();
            tabState.textareaContent = textarea.value;
            Actions.setTextareaContent(this.deps.store, this.deps.getCurrentTab(), textarea.value);
        });

        this.deps.setInputRefs({
            container: inputContainer,
            topSection,
            divider,
            textarea,
            sendButton: sendBtn,
            modelButton: modelBtn,
            quickEditsButton: quickEditsBtn,
            addContextButton,
            contextPinButton: contextPin,
            contextCloseButton: contextClose
        });

        // Provide UI refs to ContextService so it doesn't query the DOM.
        if (userContextTooltipEl) {
            this.deps.contextService.setUIRefs({
                topSectionEl: topSection,
                contextValueEl: contextValue,
                contextInfoEl: contextInfo,
                contextCloseButtonEl: contextClose,
                addContextButtonEl: addContextButton,
                contextPinButtonEl: contextPin,
                userContextTooltipEl
            });
        }

        // Initial context visibility (web mode hides context block)
        this.deps.updateContextVisibility();

        // Note: Drag and drop functionality is now handled by DragDropService

        return inputContainer;
    }
}
