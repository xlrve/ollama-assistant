import type { EventBus } from '../core/event-bus';
import type { Store } from '../core/store';
import type { ContextService } from './context-service';

interface DragDropServiceDeps {
    eventBus: EventBus;
    store: Store;
    contextService: ContextService;
    getInputContainerEl: () => HTMLElement | null;
    getTextareaEl: () => HTMLTextAreaElement | null;
}

/**
 * DragDropService - handles drag and drop functionality for adding text to context.
 * Event-Driven: listens to mode changes, manages visual indicators via CSS classes.
 */
export class DragDropService {
    private dragStartHandler: ((e: DragEvent) => void) | null = null;
    private dragEndHandler: (() => void) | null = null;

    constructor(private deps: DragDropServiceDeps) {}

    start(): void {
        const inputContainerEl = this.deps.getInputContainerEl();
        const textareaEl = this.deps.getTextareaEl();
        if (!inputContainerEl || !textareaEl) return;

        // Global dragstart - show pulsing border when user starts dragging text anywhere
        this.dragStartHandler = (e: DragEvent) => {
            const currentMode = this.deps.store.getState().ui.currentTab;
            // Skip in web mode (context not supported)
            if (currentMode === 'web') return;

            // Check if dragging text (not a file or image)
            if (e.dataTransfer && e.dataTransfer.types.includes('text/plain')) {
                inputContainerEl.addClass('drag-active');
                this.deps.eventBus.emit('dragdrop:started', { hasText: true });
            }
        };

        // Global dragend - remove pulsing border when drag ends
        this.dragEndHandler = () => {
            inputContainerEl.removeClass('drag-active');
            inputContainerEl.removeClass('drag-over');
            this.deps.eventBus.emit('dragdrop:ended');
        };

        // Attach global listeners
        document.addEventListener('dragstart', this.dragStartHandler);
        document.addEventListener('dragend', this.dragEndHandler);

        // Input container dragover
        inputContainerEl.addEventListener('dragover', this.handleDragOver.bind(this));

        // Input container dragleave
        inputContainerEl.addEventListener('dragleave', this.handleDragLeave.bind(this));

        // Input container drop
        inputContainerEl.addEventListener('drop', this.handleDrop.bind(this));

        // Block drag&drop into textarea in web mode
        textareaEl.addEventListener('drop', this.handleTextareaDrop.bind(this));
        textareaEl.addEventListener('dragover', this.handleTextareaDragOver.bind(this));
    }

    private handleDragOver(e: DragEvent): void {
        const currentMode = this.deps.store.getState().ui.currentTab;
        // Skip in web mode (context not supported)
        if (currentMode === 'web') return;

        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }

        const inputContainerEl = this.deps.getInputContainerEl();
        if (inputContainerEl) {
            inputContainerEl.addClass('drag-over');
            this.deps.eventBus.emit('dragdrop:hovering', { isOver: true });
        }
    }

    private handleDragLeave(e: DragEvent): void {
        const inputContainerEl = this.deps.getInputContainerEl();
        if (!inputContainerEl) return;

        // Only remove class if we're leaving the inputContainer entirely
        const rect = inputContainerEl.getBoundingClientRect();
        if (
            e.clientX < rect.left ||
            e.clientX >= rect.right ||
            e.clientY < rect.top ||
            e.clientY >= rect.bottom
        ) {
            inputContainerEl.removeClass('drag-over');
            this.deps.eventBus.emit('dragdrop:hovering', { isOver: false });
        }
    }

    private handleDrop(e: DragEvent): void {
        const currentMode = this.deps.store.getState().ui.currentTab;
        const inputContainerEl = this.deps.getInputContainerEl();

        if (!inputContainerEl) return;

        // Skip in web mode (context not supported)
        if (currentMode === 'web') {
            inputContainerEl.removeClass('drag-over');
            inputContainerEl.removeClass('drag-active');
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        inputContainerEl.removeClass('drag-over');
        inputContainerEl.removeClass('drag-active');

        const droppedText = e.dataTransfer?.getData('text/plain');
        if (droppedText && droppedText.trim()) {
            // Add dropped text to context
            this.deps.contextService.setSelectedText(droppedText.trim(), false);
            this.deps.eventBus.emit('dragdrop:textAdded', { text: droppedText.trim() });
        }

        this.deps.eventBus.emit('dragdrop:ended');
    }

    private handleTextareaDrop(e: DragEvent): void {
        const currentMode = this.deps.store.getState().ui.currentTab;
        if (currentMode === 'web') {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private handleTextareaDragOver(e: DragEvent): void {
        const currentMode = this.deps.store.getState().ui.currentTab;
        if (currentMode === 'web') {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'none';
            }
        }
    }

    cleanup(): void {
        // Remove global listeners
        if (this.dragStartHandler) {
            document.removeEventListener('dragstart', this.dragStartHandler);
            this.dragStartHandler = null;
        }
        if (this.dragEndHandler) {
            document.removeEventListener('dragend', this.dragEndHandler);
            this.dragEndHandler = null;
        }

        // Remove classes
        const inputContainerEl = this.deps.getInputContainerEl();
        if (inputContainerEl) {
            inputContainerEl.removeClass('drag-active');
            inputContainerEl.removeClass('drag-over');
        }
    }
}
