import { requestUrl } from 'obsidian';

export interface OllamaSettings {
    baseUrl: string;
    model: string;
    temperature: number;
    forceEnableWebMode?: boolean;
}

export interface OllamaMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;

    // Optional function-calling payloads (used in Web mode agent loop)
    tool_calls?: Array<{
        function: {
            name: string;
            arguments: unknown;
        };
    }>;
}

export interface StreamChunk {
    type: 'thinking' | 'content' | 'tool_call' | 'metrics';
    text: string;
    tool?: {
        name: string;
        arguments: unknown;
    };
    metrics?: {
        eval_count: number;
        eval_duration: number; // in nanoseconds
        prompt_eval_count: number;
        speed: number; // tokens per second
    };
}

export interface OllamaTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            required: string[];
            properties: Record<string, {
                type: string;
                description: string;
            }>;
        };
    };
}

export interface OllamaResponse {
    model: string;
    created_at: string;
    message: {
        role: string;
        content: string;
    };
    done: boolean;
}

type ToolFormat = 'native' | 'unsupported' | 'none';

interface ToolCapability {
    supported: boolean;
    format: ToolFormat;
}

export class OllamaClient {
    private settings: OllamaSettings;
    private modelSupportsTools: boolean = false;
    private toolFormat: ToolFormat = 'none';
    private toolsSupportCache: Map<string, ToolCapability> = new Map();

    constructor(settings: OllamaSettings) {
        this.settings = settings;
    }

    updateSettings(settings: OllamaSettings) {
        this.settings = settings;
        // Check cache for new model
        const cached = this.toolsSupportCache.get(settings.model);
        if (cached !== undefined) {
            this.modelSupportsTools = cached.supported;
            this.toolFormat = cached.format;
        } else {
            this.modelSupportsTools = false;
            this.toolFormat = 'none';
        }
    }

    private modelSupportsThinking(): boolean {
        const modelLower = this.settings.model.toLowerCase();
        // Only certain models support the 'think' parameter
        // DeepSeek-R1 models explicitly support thinking
        // Most other models (qwen, llama, etc) don't support it
        return modelLower.includes('deepseek') && modelLower.includes('r1');
    }

    async checkModelToolSupport(): Promise<boolean> {
        // Check cache first
        const cached = this.toolsSupportCache.get(this.settings.model);
        if (cached !== undefined) {
            this.modelSupportsTools = cached.supported;
            this.toolFormat = cached.format;
            return cached.supported;
        }

        try {
            const response = await requestUrl({
                url: `${this.settings.baseUrl}/api/show`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: this.settings.model })
            });

            if (response.status !== 200) {
                this.toolsSupportCache.set(this.settings.model, { supported: false, format: 'none' });
                return false;
            }

            const data = response.json;

            // Check capabilities array for 'tools'
            const hasToolsCapability = data.capabilities &&
                           Array.isArray(data.capabilities) &&
                           data.capabilities.includes('tools');

            // Detect format from template
            let format: ToolFormat = 'none';
            if (hasToolsCapability) {
                if (!data.template) {
                    // No template (cloud models) - assume native
                    format = 'native';
                } else {
                    const template = data.template.toLowerCase();
                    // Check for incompatible formats
                    if (template.includes('[tool_calls]')) {
                        // Mistral format - unsupported
                        format = 'unsupported';
                    } else if (template.includes('.toolcalls') && !template.includes('<tool_call>')) {
                        // Llama format - has tool output format but no auto-parsing
                        format = 'unsupported';
                    } else {
                        // Native format (Qwen, functiongemma, cloud models, etc.)
                        format = 'native';
                    }
                }
            }

            // Only consider tools supported if format is 'native' (not Mistral-only)
            let hasTools = hasToolsCapability && format === 'native';

            // Force enable if user explicitly requested it
            if (this.settings.forceEnableWebMode) {
                hasTools = true;
                console.debug(`[Model Tools] ${this.settings.model} ✓ tools (forced)`);
            } else {
                console.debug(`[Model Tools] ${this.settings.model} ${hasTools ? '✓' : '✗'} tools (${format})`);
            }

            // Cache and return result
            const capability: ToolCapability = { supported: hasTools, format };
            this.toolsSupportCache.set(this.settings.model, capability);
            this.modelSupportsTools = hasTools;
            this.toolFormat = format;
            return hasTools;
        } catch (err) {
            // Network error - DON'T cache this! It's a temporary state.
            // When Ollama becomes available, we need to re-check.
            console.error('Failed to check model tool support:', err);
            return false;
        }
    }

    getModelSupportsTools(): boolean {
        return this.modelSupportsTools;
    }

    async chat(messages: OllamaMessage[]): Promise<string> {
        try {
            const response = await requestUrl({
                url: `${this.settings.baseUrl}/api/chat`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: messages,
                    stream: false,
                    options: {
                        temperature: this.settings.temperature,
                    }
                }),
            });

            if (response.status !== 200) {
                throw new Error(`Ollama API error: ${response.status}`);
            }

            const data: OllamaResponse = response.json;
            return data.message.content;
        } catch (error) {
            console.error('Error calling Ollama API:', error);
            throw error;
        }
    }

    async chatStream(messages: OllamaMessage[], onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal, tools?: OllamaTool[]): Promise<void> {
        try {
            const requestBody: {
                model: string;
                messages: OllamaMessage[];
                stream: boolean;
                options: {
                    temperature: number;
                };
                think?: boolean;
                tools?: OllamaTool[];
            } = {
                model: this.settings.model,
                messages: messages,
                stream: true,
                options: {
                    temperature: this.settings.temperature,
                }
            };

            // Only add 'think' parameter if model supports it
            if (this.modelSupportsThinking()) {
                requestBody.think = true;
            }

            // Add tools if provided
            if (tools && tools.length > 0) {
                requestBody.tools = tools;
            }

            // fetch is required here because Obsidian's requestUrl does not support ReadableStream for streaming responses
            const response = await fetch(`${this.settings.baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: signal
            });

            if (!response.ok) {
                // Try to get error details from response body
                let errorMessage = '';
                try {
                    const errorBody = await response.text();
                    if (errorBody) {
                        try {
                            // Try to parse as JSON first
                            const errorJson = JSON.parse(errorBody);
                            if (errorJson.error) {
                                errorMessage = errorJson.error;
                            }
                        } catch {
                            // If not JSON, use raw text
                            errorMessage = errorBody;
                        }
                    }
                } catch (e) {
                    // Ignore if can't read error body
                }

                // Special handling for 400 errors
                if (response.status === 400 && errorMessage.includes('prompt too long')) {
                    throw new Error(`Message is too long. Please clear chat history (Clear History button) or use shorter messages.`);
                }

                throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorMessage ? ' - ' + errorMessage : ''}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                }
                
                if (done) {
                    // Process remaining buffer
                    buffer += decoder.decode();
                }

                const lines = buffer.split('\n');
                buffer = done ? '' : (lines.pop() || '');

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const json = JSON.parse(line);
                            const hasToolCall = json.message?.tool_calls && json.message.tool_calls.length > 0;

                            // Handle tool calls FIRST (priority over content)
                            if (hasToolCall) {
                                const toolCall = json.message.tool_calls[0];
                                onChunk({
                                    type: 'tool_call',
                                    text: '',
                                    tool: {
                                        name: toolCall.function.name,
                                        arguments: toolCall.function.arguments
                                    }
                                });
                            }

                            // Send thinking if present (even with tool_call)
                            if (json.message?.thinking) {
                                onChunk({ type: 'thinking', text: json.message.thinking });
                            }

                            // Send content ONLY if NO tool_call in this chunk
                            if (!hasToolCall && json.message?.content) {
                                onChunk({ type: 'content', text: json.message.content });
                            }
                            
                            // If this is the final response, send metrics
                            if (json.done) {
                                // Send metrics if we have token counts (even without duration for cloud models)
                                if (json.eval_count || json.prompt_eval_count) {
                                    const speed = (json.eval_count && json.eval_duration)
                                        ? (json.eval_count / json.eval_duration) * 1000000000 // nanoseconds to seconds
                                        : 0; // Cloud models don't return duration
                                    onChunk({
                                        type: 'metrics',
                                        text: '',
                                        metrics: {
                                            eval_count: json.eval_count || 0,
                                            eval_duration: json.eval_duration || 0,
                                            prompt_eval_count: json.prompt_eval_count || 0,
                                            speed: speed
                                        }
                                    });
                                }
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    }
                }
                
                if (done) break;
            }
        } catch (error) {
            console.error('Error calling Ollama API:', error);
            throw error;
        }
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await requestUrl({
                url: `${this.settings.baseUrl}/api/tags`,
                method: 'GET',
            });

            if (response.status !== 200) {
                throw new Error(`Ollama API error: ${response.status}`);
            }

            const data: unknown = response.json;
            if (!data || typeof data !== 'object' || !('models' in data)) return [];

            const models = (data as { models?: unknown }).models;
            if (!Array.isArray(models)) return [];

            return models
                .map((model) => (model && typeof model === 'object' && 'name' in model ? (model as { name?: unknown }).name : undefined))
                .filter((name): name is string => typeof name === 'string');
        } catch (error) {
            console.error('Error fetching models from Ollama:', error);
            return [];
        }
    }

    async checkConnection(): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: `${this.settings.baseUrl}/api/tags`,
                method: 'GET',
            });
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    async getModelStats(): Promise<{
        loaded_model?: string;
        loaded?: boolean;
        size_vram?: number;
        vram_size?: number;
        context_window?: number;
    } | null> {
        try {
            const response = await requestUrl({
                url: `${this.settings.baseUrl}/api/ps`,
                method: 'GET',
            });
            if (response.status !== 200) return null;

            const data = response.json;

            // Get first model stats (currently running model)
            if (data.models && data.models.length > 0) {
                const modelStats = data.models[0];

                // Also get context window from model info
                let contextWindow = 4096; // default
                try {
                    const showResp = await requestUrl({
                        url: `${this.settings.baseUrl}/api/show`,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: this.settings.model })
                    });
                    if (showResp.status === 200) {
                        const showData = showResp.json;
                        if (showData.model_info) {
                            const ctxParam = showData.model_info['llama.context_length'] ||
                                           showData.model_info['mistral.context_length'] ||
                                           showData.model_info['context_length'];
                            if (ctxParam) contextWindow = parseInt(ctxParam);
                        }
                    }
                } catch (e) {
                    // Use default if error
                }

                return {
                    loaded_model: modelStats.name,
                    loaded: true,
                    size_vram: modelStats.size_vram,
                    vram_size: modelStats.size_vram,
                    context_window: contextWindow
                };
            }
            return null;
        } catch (error) {
            console.error('Error fetching model stats:', error);
            return null;
        }
    }
}
