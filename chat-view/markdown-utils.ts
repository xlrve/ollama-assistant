/**
 * MarkdownUtils - static utilities for working with Markdown
 */
export class MarkdownUtils {
    /**
     * Converts Markdown text to HTML
     */
    static renderMarkdown(text: string): string {
        let html = text;

        // Code blocks FIRST (```lang\ncode\n```) - preserve their content
        const codeBlocks: string[] = [];
        html = html.replace(/```(\w*)\r?\n?([\s\S]*?)\r?\n?```/g, (_match: string, lang: string, code: string): string => {
            const index = codeBlocks.length;
            // Trim leading/trailing whitespace from code
            const trimmedCode = code.trim();
            codeBlocks.push(`<pre><code class="language-${lang || 'plaintext'}">${MarkdownUtils.escapeHtml(trimmedCode)}</code></pre>`);
            return `<!--CODEBLOCK${index}-->`;
        });

        // Inline code (`code`) - preserve content
        const inlineCodes: string[] = [];
        html = html.replace(/`([^`]+)`/g, (_match: string, code: string): string => {
            const index = inlineCodes.length;
            inlineCodes.push(`<code>${MarkdownUtils.escapeHtml(code)}</code>`);
            return `<!--INLINECODE${index}-->`;
        });

        // Preserve <details> blocks (spoilers) - extract before newline conversion
        const detailsBlocks: string[] = [];
        html = html.replace(/<details>([\s\S]*?)<\/details>/gi, (_match: string, inner: string): string => {
            const index = detailsBlocks.length;
            const summaryMatch = inner.match(/<summary>([\s\S]*?)<\/summary>/i);
            const summaryHtml = summaryMatch ? `<summary>${summaryMatch[1].trim()}</summary>` : '';
            let content = summaryMatch
                ? inner.substring(inner.indexOf('</summary>') + '</summary>'.length)
                : inner;
            content = content.trim();
            if (content) {
                content = MarkdownUtils.processInlineMarkdown(content);
                content = content.replace(/\n/g, '<br>');
            }
            detailsBlocks.push(`<details>${summaryHtml}<div class="details-content">${content}</div></details>`);
            return `<!--DETAILS${index}-->`;
        });

        // Images BEFORE links (![alt](url))
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto;">');

        // Links ([text](url))
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Tables - convert markdown tables to HTML (BEFORE line breaks!)
        html = html.replace(
            /(\|[^\n]+\|\r?\n)((?:\|[-:| ]+\|\r?\n))((?:\|[^\n]+\|\r?\n?)*)/gm,
            (_match: string, header: string, _separator: string, rows: string): string => {
            let tableHtml = '<table class="markdown-table"><thead><tr>';

            // Parse header
            const headerCells = header.split('|').filter((cell: string) => cell.trim());
            headerCells.forEach((cell: string) => {
                tableHtml += `<th>${MarkdownUtils.processInlineMarkdown(cell.trim())}</th>`;
            });
            tableHtml += '</tr></thead><tbody>';

            // Parse rows
            if (rows) {
                const rowLines = rows.trim().split('\n');
                rowLines.forEach((row: string) => {
                    if (row.trim()) {
                        tableHtml += '<tr>';
                        const cells = row.split('|').filter((cell: string) => cell.trim());
                        cells.forEach((cell: string) => {
                            tableHtml += `<td>${MarkdownUtils.processInlineMarkdown(cell.trim())}</td>`;
                        });
                        tableHtml += '</tr>';
                    }
                });
            }

            tableHtml += '</tbody></table>';
            return tableHtml;
        });

        // Headers (h1-h6) - BEFORE line breaks
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Blockquotes (> text) - BEFORE line breaks
        html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

        // Horizontal rules (---, ***, ___) - BEFORE line breaks
        // Allow optional whitespace before/after the rule
        html = html.replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '<hr>');

        // Process lists as blocks - unordered lists (with task list support)
        html = html.replace(/((?:^[-*]\s+.+$\n?)+)/gm, (match: string): string => {
            const items = match.trim().split('\n').map((line: string): string => {
                const content = line.replace(/^[-*]\s+/, '');

                // Check for task list items (- [ ] or - [x])
                const taskMatch = content.match(/^\[([ xX])\]\s+(.*)$/);
                if (taskMatch) {
                    const checked = taskMatch[1].toLowerCase() === 'x';
                    const taskContent = taskMatch[2];
                    return `<li class="task-list-item"><input type="checkbox" ${checked ? 'checked' : ''} disabled> ${MarkdownUtils.processInlineMarkdown(taskContent)}</li>`;
                }

                return `<li>${MarkdownUtils.processInlineMarkdown(content)}</li>`;
            }).join('');
            return `<ul>${items}</ul>`;
        });

        // Ordered lists
        html = html.replace(/((?:^\d+\.\s+.+$\n?)+)/gm, (match: string): string => {
            const items = match.trim().split('\n').map((line: string): string => {
                const content = line.replace(/^\d+\.\s+/, '');
                return `<li>${MarkdownUtils.processInlineMarkdown(content)}</li>`;
            }).join('');
            return `<ol>${items}</ol>`;
        });

        // Now inline formatting - HIGHLIGHTS FIRST (==text==) before any other = processing
        html = html.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

        // Strikethrough (~~text~~)
        html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

        // Bold (**text** or __text__)
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

        // Italic (*text* or _text_) - must be after bold
        html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');

        // Convert newlines to <br>
        html = html.replace(/\n/g, '<br>');

        // Restore code blocks
        codeBlocks.forEach((block, i) => {
            html = html.replace(new RegExp(`<!--CODEBLOCK${i}-->`, 'g'), block);
        });

        // Restore inline codes
        inlineCodes.forEach((code, i) => {
            html = html.replace(new RegExp(`<!--INLINECODE${i}-->`, 'g'), code);
        });

        // Restore details blocks (spoilers)
        detailsBlocks.forEach((block, i) => {
            html = html.replace(new RegExp(`<!--DETAILS${i}-->`, 'g'), block);
        });

        return html;
    }

    /**
     * Escapes HTML characters
     */
    static escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#039;');
    }

    /**
     * Processes inline markdown formatting (for tables and lists)
     */
    static processInlineMarkdown(text: string): string {
        // Process highlights FIRST
        text = text.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
        // Process bold
        text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        // Process italic
        text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        return text;
    }

    /**
     * Extracts explanation and result from model response
     */
    static extractResult(text: string): { explanation: string; result: string } {
        const resultMatch = text.match(/<EDIT>([\s\S]*?)<\/EDIT>/);
        if (resultMatch) {
            const result = resultMatch[1].trim();
            const explanation = text.replace(/<EDIT>[\s\S]*?<\/EDIT>/, '').trim();
            return { explanation, result };
        }
        return { explanation: '', result: text };
    }

    /**
     * Cleans result markers from content
     * Removes malformed closing markers:
     * - </EDIT> (correct)
     * - </EDIT (missing >)
     * - <EDIT> or </EDI... (incomplete)
     */
    static cleanResultMarkers(content: string): string {
        let cleaned = content;
        // Remove service markers at boundaries without aggressive trim.
        cleaned = cleaned.replace(/^<EDIT>[ \t]*/i, '');
        cleaned = cleaned.replace(/^<EDIT>\r?\n/i, '');
        cleaned = cleaned.replace(/(\r?\n)?[ \t]*<\/EDIT>[ \t]*$/i, '');
        cleaned = cleaned.replace(/(\r?\n)?[ \t]*<\/EDIT[ \t]*$/i, '');

        // Preserve user formatting, but remove one protocol newline
        // that usually appears right after <EDIT>.
        cleaned = cleaned.replace(/^\r?\n/, '');

        return cleaned;
    }
}
