import type { RequestProcessorContext } from './request-context';
import type { OllamaMessage } from '../../ollama-client';

export interface ToolCallRequest {
    name: string;
    arguments: unknown;
}

export interface ToolCallResult {
    statusText?: string;
    toolMessages: OllamaMessage[];
    systemMessages?: OllamaMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * ToolCallHandler - centralized execution of tool_calls (web_search/fetch_page).
 */
export class ToolCallHandler {
    constructor(private ctx: RequestProcessorContext) {}

    async executeToolCall(toolCall: ToolCallRequest): Promise<ToolCallResult> {
        if (toolCall.name === 'web_search') {
            const args = toolCall.arguments;
            const query = isRecord(args) && typeof args.query === 'string' ? args.query : '';
            if (!query) throw new Error('web_search requires a string "query"');

            const searchResults = await this.ctx.plugin.webSearchClient.searchText(query, 3);
            const toolResult = this.ctx.plugin.webSearchClient.formatResultsForAI(searchResults) +
                '\n\n[INSTRUCTION: Use fetch_page() function to read ONE relevant site. Do NOT write text - call fetch_page via tool call!]';

            return {
                statusText: `✓ Found ${searchResults.length} sites`,
                toolMessages: [
                    {
                        role: 'assistant',
                        content: '',
                        tool_calls: [{
                            function: {
                                name: 'web_search',
                                arguments: { query }
                            }
                        }]
                    },
                    {
                        role: 'tool',
                        content: toolResult
                    }
                ],
                systemMessages: [
                    {
                        role: 'system',
                        content: 'IMPORTANT: Continue using TOOL CALLS (don\'t write fetch_page as text - call it via tool call!)'
                    }
                ]
            };
        }

        if (toolCall.name === 'fetch_page') {
            const args = toolCall.arguments;
            const url = isRecord(args) && typeof args.url === 'string' ? args.url : '';
            if (!url) throw new Error('fetch_page requires a string "url"');

            const pageContent = await this.ctx.plugin.webSearchClient.fetchPageContent(url);

            console.debug('[FETCH PAGE] Title:', pageContent.title);
            console.debug('[FETCH PAGE] URL:', pageContent.url);
            console.debug('[FETCH PAGE] Text length:', pageContent.text.length);

            const toolResult = `PAGE DATA:

Title: ${pageContent.title}
URL: ${pageContent.url}

Page text:
${pageContent.text}

[INSTRUCTION: Use ONLY information from "Page text" above. Quote facts and numbers verbatim. Don't add anything from yourself.]`;

            return {
                statusText: '✓ Page read',
                toolMessages: [
                    {
                        role: 'assistant',
                        content: '',
                        tool_calls: [{
                            function: {
                                name: 'fetch_page',
                                arguments: { url }
                            }
                        }]
                    },
                    {
                        role: 'tool',
                        content: toolResult
                    }
                ]
            };
        }

        throw new Error(`Unsupported tool call: ${toolCall.name}`);
    }
}
