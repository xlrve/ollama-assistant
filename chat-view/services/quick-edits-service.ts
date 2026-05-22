/**
 * QuickEditsService - manages quick prompts menu for input.
 */
export class QuickEditsService {
    private menuEl: HTMLElement | null = null;

    toggleQuickEditsMenu(buttonEl: HTMLElement | null, textareaEl: HTMLTextAreaElement | null, bodyEl: HTMLElement): void {
        // Defensive: if some stale menu exists (e.g., view re-open), remove it.
        const stale = bodyEl.querySelector('.quick-edits-menu');
        if (stale && stale !== this.menuEl) stale.remove();

        if (this.menuEl) {
            this.menuEl.remove();
            this.menuEl = null;
            return;
        }

        const menu = bodyEl.createEl('div', { cls: 'quick-edits-menu' });
        this.menuEl = menu;

        const quickEdits = [
            'Add heading',
            'Add emoji',
            'Shorten text',
            'Expand text',
            'Add content to table',
            'Fix spelling mistakes',
            'Fix grammar'
        ];

        quickEdits.forEach(edit => {
            const item = menu.createEl('div', {
                cls: 'menu-item',
                text: edit
            });
            item.addEventListener('click', () => {
                if (textareaEl) {
                    textareaEl.value = edit;
                    textareaEl.dispatchEvent(new Event('input'));
                }
                menu.remove();
                this.menuEl = null;
            });
        });

        if (buttonEl) {
            const rect = buttonEl.getBoundingClientRect();
            const view = bodyEl.ownerDocument.defaultView ?? activeWindow;
            menu.setCssProps({ '--oa-right': (view.innerWidth - rect.right) + 'px', '--oa-bottom': (view.innerHeight - rect.top) + 'px' });
        }

        (bodyEl.ownerDocument.defaultView ?? activeWindow).setTimeout(() => {
            const doc = bodyEl.ownerDocument;
            doc.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target as Node)) {
                    menu.remove();
                    doc.removeEventListener('click', closeMenu);
                }
            });
        }, 0);
    }
}
