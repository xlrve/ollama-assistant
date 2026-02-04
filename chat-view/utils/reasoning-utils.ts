export function extractTextFromReasoningHtml(html: string): string {
    if (!html) return '';

    const cleaned = html
        .replace(/<div[^>]*class\s*=\s*["'][^"']*\breasoning-header\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<button[^>]*class\s*=\s*["'][^"']*\breasoning-toggle\b[^"']*["'][^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<span[^>]*class\s*=\s*["'][^"']*\bcursor-blink\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '');

    const withLineBreaks = cleaned.replace(/<br\s*\/?>/gi, '\n');

    const text = withLineBreaks
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');

    const withoutToggle = text.replace(/(?:^|\n)\s*(Show reasoning|Hide reasoning)\s*(?:\n|$)/gi, '\n');
    return withoutToggle.trim();
}
