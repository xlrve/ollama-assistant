/**
 * Safe HTML insertion using DOMParser instead of innerHTML.
 * Parses HTML string and moves resulting nodes into the target element.
 */
export function safeSetHtml(el: HTMLElement, html: string): void {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    el.empty();
    while (doc.body.firstChild) {
        el.appendChild(doc.body.firstChild);
    }
}
