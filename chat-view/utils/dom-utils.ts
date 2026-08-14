import DOMPurify from 'dompurify';

/**
 * Safe HTML insertion using DOMParser instead of innerHTML.
 * HTML is sanitized with DOMPurify first: strips <script>, inline event
 * handlers (onerror/onclick/...) and javascript: URLs from untrusted
 * (model-generated) content. Parses the clean HTML string and moves
 * resulting nodes into the target element.
 */
export function safeSetHtml(el: HTMLElement, html: string): void {
    const clean = DOMPurify.sanitize(html, {
        // Tags/attrs the plugin's own markdown renderer produces
        ADD_TAGS: ['details', 'summary', 'input', 'mark'],
        ADD_ATTR: ['checked', 'disabled', 'type', 'target']
    });
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    el.empty();
    while (doc.body.firstChild) {
        el.appendChild(doc.body.firstChild);
    }
}
