import { requestUrl } from 'obsidian';

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface ImageResult {
    title: string;
    url: string;
    thumbnail: string;
}

export interface PageContent {
    url: string;
    title: string;
    text: string;
    meta?: {
        description?: string;
        keywords?: string[];
        author?: string;
        publishedDate?: string;
    };
    links?: string[];
    error?: string;
}

export class WebSearchClient {
    
    // Search web pages using DuckDuckGo.
    async searchText(query: string, maxResults: number = 5): Promise<SearchResult[]> {
        console.debug(`🔍 Searching for: "${query}"`);
        
        try {
            const ddgResults = await this.searchDuckDuckGo(query, maxResults);
            console.debug(`✅ DuckDuckGo returned ${ddgResults.length} results`);
            return ddgResults;
        } catch (error) {
            console.error('❌ DuckDuckGo search failed:', error);
            return [];
        }
    }
    
    // Image search is intentionally disabled to keep network behavior limited and predictable.
    async searchImages(query: string, maxResults: number = 6): Promise<ImageResult[]> {
        console.debug(`Image search disabled; skipping image lookup for: "${query}"`, maxResults);
        return [];
    }
    
    // Fetch page content for reading
    async fetchPageContent(url: string): Promise<PageContent> {
        try {

            
            console.debug(`📄 Reading: ${url}`);
            
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const html = response.text;
            
            // Extract title
            const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Untitled';
            
            // Extract meta tags
            const meta: Record<string, unknown> = {};
            
            // Description
            const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
                            html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
            if (descMatch) meta.description = descMatch[1];
            
            // Keywords
            const keywordsMatch = html.match(/<meta\s+name=["']keywords["']\s+content=["']([^"']+)["']/i);
            if (keywordsMatch) meta.keywords = keywordsMatch[1].split(',').map((k: string) => k.trim());
            
            // Author
            const authorMatch = html.match(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i);
            if (authorMatch) meta.author = authorMatch[1];
            
            // Published date
            const dateMatch = html.match(/<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i);
            if (dateMatch) meta.publishedDate = dateMatch[1];
            
            // Extract links
            const links: string[] = [];
            const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
            let linkMatch;
            while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 20) {
                const href = linkMatch[1];
                // Only external links, skip anchors and javascript
                if (href.startsWith('http') && !href.includes(url)) {
                    links.push(href);
                }
            }
            
            // Clean HTML
            const cleanHtml = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
                .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
                .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
                .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
                .replace(/<!--[\s\S]*?-->/g, '');
            
            // Extract main content
            const mainMatch = cleanHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                            cleanHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                            cleanHtml.match(/<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                            cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            
            let text = mainMatch ? mainMatch[1] : cleanHtml;
            
            // Remove HTML tags and decode entities
            text = text
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&mdash;/g, '—')
                .replace(/&ndash;/g, '–')
                .replace(/&hellip;/g, '...')
                .replace(/\s+/g, ' ')
                .trim();
            
            // Limit size (6000 chars as recommended)
            text = text.substring(0, 6000);
            
            console.debug(`✅ Read ${text.length} chars, ${links.length} links, meta:`, Object.keys(meta));
            
            return { 
                url, 
                title, 
                text,
                meta: Object.keys(meta).length > 0 ? meta : undefined,
                links: links.length > 0 ? links : undefined
            };
            
        } catch (error) {
            console.error(`❌ Failed to read ${url}:`, error);
            return {
                url,
                title: 'Error',
                text: '',
                error: error.message
            };
        }
    }
    
    // DuckDuckGo search implementation
    private async searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {

        
        const response = await requestUrl({
            url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = response.text;
        const results: SearchResult[] = [];

        const titleRegex = /<h2 class="result__title">\s*<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
        
        let match;
        while ((match = titleRegex.exec(html)) !== null && results.length < maxResults) {
            let url = match[1];
            const title = match[2].replace(/<[^>]+>/g, '').trim();
            
            // Extract real URL from DuckDuckGo redirect
            if (url.includes('uddg=')) {
                const realUrl = url.match(/uddg=([^&]+)/);
                if (realUrl) {
                    url = decodeURIComponent(realUrl[1]);
                }
            }
            
            // Find snippet
            const snippetMatch = html.slice(match.index).match(/<a class="result__snippet"[^>]*>(.*?)<\/a>/i);
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : title;
            
            if (url && title) {
                results.push({
                    title,
                    url: url.startsWith('//') ? `https:${url}` : url,
                    snippet: snippet.substring(0, 200)
                });
            }
        }

        return results;
    }

    // Format results for AI consumption
    formatResultsForAI(textResults: SearchResult[], imageResults?: ImageResult[]): string {
        let formatted = '';

        if (textResults.length > 0) {
            formatted += '=== Search Results ===\n\n';
            textResults.forEach((result, index) => {
                formatted += `${index + 1}. ${result.title}\n`;
                formatted += `   URL: ${result.url}\n`;
                formatted += `   ${result.snippet}\n\n`;
            });
        }

        if (imageResults && imageResults.length > 0) {
            formatted += '=== Found Images ===\n\n';
            imageResults.forEach((result, index) => {
                formatted += `${index + 1}. ${result.title}\n`;
                formatted += `   URL: ${result.url}\n\n`;
            });
        }

        return formatted;
    }
}
