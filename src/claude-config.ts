// src/claude-config.ts
export interface ClaudeConfig {
  model: string;
  maxTokens: number;
  timeout: number; // ms
  apiKey?: string;
}

type ClaudeCallOptions = { temperature?: number; max_tokens?: number };

export class ClaudeClient {
  private model: string;
  private maxTokens: number;
  private timeout: number;
  private apiKey: string;

  constructor(cfg?: Partial<ClaudeConfig>) {
    this.model = cfg?.model ?? 'claude-sonnet-4-20250514';
    this.maxTokens = cfg?.maxTokens ?? 4000;
    this.timeout = cfg?.timeout ?? 120000;
    this.apiKey = cfg?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  }

  async makeRequest(
    prompt: string,
    onStream?: (chunk: string) => void,
    options?: ClaudeCallOptions
  ): Promise<{ success: boolean; data?: string; usage?: Record<string, any>; error?: string }> {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.apiKey });

      const response = await client.messages.create({
        model: this.model,
        max_tokens: options?.max_tokens ?? this.maxTokens,
        temperature: options?.temperature ?? 0.2,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response format from Claude');
      }

      const data = content.text;
      
      // If streaming callback is provided, call it with the data
      if (onStream) onStream(data);

      return { 
        success: true, 
        data, 
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          model: this.model
        }
      };
    } catch (e: any) {
      return { success: false, error: String(e?.message || e) };
    }
  }

  // Legacy compatibility methods for dax-analyzer.ts
  buildAnalysisPrompt(type: string, data: any, includeExamples?: boolean, context?: any): string {
    return `Analyze this ${type}: ${JSON.stringify(data)}`;
  }

  parseJSONResponse(text: string): any {
    try {
      return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch {
      return {};
    }
  }

  async makeBatchRequest<T>(requests: Array<{ id: string; prompt: string; parseResponse: (text: string) => T }>): Promise<Array<{ id: string; success: boolean; data?: T; error?: string }>> {
    const results = [];
    for (const request of requests) {
      const response = await this.makeRequest(request.prompt);
      results.push({
        id: request.id,
        success: response.success,
        data: response.success ? request.parseResponse(response.data || '') : undefined,
        error: response.error
      });
    }
    return results;
  }

  getUsageStats(): { requests: number; lastRequest: Date | null } {
    return { requests: 0, lastRequest: null };
  }
}

export { ClaudeCallOptions };