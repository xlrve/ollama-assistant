/**
 * MarkdownUtils - utilities for working with markdown
 * (Moved from chat-view/markdown-utils.ts without changes)
 */

import { MarkdownRenderer as ObsidianMarkdownRenderer } from 'obsidian';

export class MarkdownUtils {
    /**
     * Render markdown to HTML
     */
    static renderMarkdown(content: string): string {
        // Escape HTML special characters
        const escaped = this.escapeHtml(content);

        // Process markdown
        const processed = this.processInlineMarkdown(escaped);

        return processed;
    }

    /**
     * Escape HTML special characters
     */
    static escapeHtml(text: string): string {
        const map: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }

    /**
     * Process inline markdown
     */
    static processInlineMarkdown(text: string): string {
        // Bold: **text** or __text__
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

        // Italic: *text* or _text_
        text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
        text = text.replace(/_(.+?)_/g, '<em>$1</em>');

        // Code: `code`
        text = text.replace(/`(.+?)`/g, '<code>$1</code>');

        // Line breaks
        text = text.replace(/\n/g, '<br>');

        return text;
    }

    /**
     * Extract result from EDIT tags
     */
    static extractResult(text: string): string {
        const match = text.match(/<EDIT>([\s\S]*?)<\/EDIT>/);
        return match ? match[1].trim() : text;
    }

    /**
     * Clean result markers
     */
    static cleanResultMarkers(text: string): string {
        // Remove opening and closing EDIT tags and everything after closing tag
        let cleaned = text.replace(/<\/?EDIT>[\s\S]*$/i, '').trim();

        // Remove any remaining closing tags
        cleaned = cleaned.replace(/<\/EDIT>/gi, '').trim();

        return cleaned;
    }
}
