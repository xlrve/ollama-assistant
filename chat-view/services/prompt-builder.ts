/**
 * PromptBuilder - builds prompts for different modes
 * Extracted from RequestProcessor for simplicity and testing.
 */

import type { OllamaMessage } from '../../ollama-client';
import type { Turn } from '../types';

export interface PromptContext {
    message: string;
    selectedText?: string;
    noteContent?: string;
    turns?: Turn[];
    maxHistoryMessages?: number;
}

export class PromptBuilder {
    private buildHistoryFromTurns(turns: Turn[], maxHistoryMessages?: number): OllamaMessage[] {
        const historyTurns = maxHistoryMessages ? turns.slice(-maxHistoryMessages) : turns;
        const messages: OllamaMessage[] = [];

        historyTurns.forEach((turn) => {
            if (turn.user?.content) {
                messages.push({ role: 'user', content: turn.user.content });
            }
            if (turn.assistant?.content) {
                messages.push({ role: 'assistant', content: turn.assistant.content });
            }
        });

        return messages;
    }
    /**
     * Build prompt for Edit mode
     */
    buildEditPrompt(context: PromptContext): { messages: OllamaMessage[]; contextNote: string } {
        const { message, selectedText } = context;

        // Context note - only if text is selected
        const hasContext = selectedText && selectedText.trim().length > 0;
        const contextNote = hasContext ? `Selected fragment:\n${selectedText}` : '';

        // System prompt for Edit
        const systemPrompt = 'You are a note editing assistant for Obsidian. EDIT MODE.\n\nYour response consists of two parts:\n\n1) First, explain what you\'re doing\n2) Then the edited text inside <EDIT>...</EDIT>\n\nResponse format:\n[Your explanation]\n<EDIT>\n[Fully edited text]\n</EDIT>\n\nIMPORTANT: Answer in the SAME LANGUAGE as the user\'s request.';

        // User message content (message + context if exists)
        const userMessageContent = contextNote 
            ? `${contextNote}\n\nRequest: ${message}`
            : message;

        // Messages array (NO history for Edit mode)
        const messages: OllamaMessage[] = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: userMessageContent
            }
        ];

        return { messages, contextNote };
    }

    /**
     * Build prompt for Discuss mode
     */
    buildDiscussPrompt(context: PromptContext): { messages: OllamaMessage[]; contextNote: string } {
        const { message, selectedText, turns = [], maxHistoryMessages } = context;

        // Context note - only if text is selected
        const hasContext = selectedText && selectedText.trim().length > 0;
        const contextNote = hasContext ? `Selected fragment:\n${selectedText}` : '';

        // System prompt for Discuss
        const systemPrompt = 'You are a smart assistant in Obsidian. The user wants to discuss a note or ask a question.\n\nRespond naturally and clearly, like in a regular conversation. Help understand the topic, explain, give advice. Be friendly and helpful!\n\nIMPORTANT: Answer in the SAME LANGUAGE as the user\'s request.';

        // User message content
        const userMessageContent = contextNote
            ? `${contextNote}\n\nRequest: ${message}`
            : message;

        // Messages array (WITH history for Discuss mode)
        const messages: OllamaMessage[] = [
            {
                role: 'system',
                content: systemPrompt
            }
        ];

        // Add recent history from turns (user + assistant only)
        if (turns.length > 0) {
            messages.push(...this.buildHistoryFromTurns(turns, maxHistoryMessages));
        }

        // Add current user message
        messages.push({
            role: 'user',
            content: userMessageContent
        });

        return { messages, contextNote };
    }

    /**
     * Build prompt for Web mode
     */
    buildWebPrompt(context: PromptContext): { messages: OllamaMessage[]; contextNote: string } {
        const { message } = context;

        // Web mode - no note context
        const contextNote = '';

        // System prompt for Web (Agent with tools)
        const systemPrompt = 'You are an internet researcher. CRITICALLY IMPORTANT:\n\n❌ You do NOT have access to current information\n❌ Your knowledge is OUTDATED (training ended long ago)\n❌ You do NOT know current data: weather, time, news, prices, exchange rates, etc.\n\n✅ You MUST use web_search and fetch_page tools for ANY request\n✅ ALWAYS start with search - NEVER answer from memory\n✅ Even simple questions require verification through search\n\nRULES:\n1. First step is ALWAYS web_search - no exceptions\n2. Read ONLY the FIRST relevant site via fetch_page (don\'t read everything!)\n3. Use ONLY information from the page you read - QUOTE facts and numbers VERBATIM\n4. Do NOT make up data - if it\'s not in the page text, say so honestly\n5. Do NOT mix information from different sources\n6. Limit your work: 1 search + 1 page read = answer\n7. Give SHORT, CONCISE answers - no long explanations\n8. Answer in the SAME LANGUAGE as the user\'s question\n\nEXAMPLE:\nUser: "what\'s the weather in Moscow?"\n→ You: web_search("moscow weather now")\n→ System: 3 websites\n→ You: fetch_page(first relevant URL)\n→ System: page text\n→ You: Brief answer in user\'s language, quoting temperature verbatim';

        // Messages array (NO history for Web mode currently - can be added later)
        const messages: OllamaMessage[] = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: message
            }
        ];

        return { messages, contextNote };
    }
}
