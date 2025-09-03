// src/agents/base-agent.ts
export type AgentProgressStage = 'started' | 'completed' | 'error';
export type AgentProgressCallback = (agentType: string, stage: AgentProgressStage, result?: AgentResult, error?: Error) => void;

export interface AgentResult {
  agentType: string;
  analysis: string | Record<string, any>;
  confidence: number;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface AgentContext {
  // Parsed INFO.VIEW() CSVs normalized
  measures?: any[];
  tables?: any[];
  columns?: any[];
  relationships?: any[];

  // Enrichment from DomainClassifier
  domain?: string;
  stakeholders?: string[];
  businessContext?: string;

  // Orchestrator extras
  rawReport?: any;       // synthesis JSON handed to polish
  directory?: string;    // for artifacts
  maxMeasures?: number;  // optional hint for Agent 4
}

export interface ClaudeCallOptions {
  temperature?: number;
  max_tokens?: number;
}

export interface ClaudeClient {
  makeRequest(prompt: string, onStream?: (text: string) => void, options?: ClaudeCallOptions): Promise<{
    success: boolean;
    data?: string;
    usage?: Record<string, any>;
    error?: string;
  }>;
}

export abstract class BaseAgent {
  protected constructor(public readonly agentType: string) {}

  protected abstract buildPrompt(context: AgentContext): string;

  protected createResult(
    analysis: string | Record<string, any>,
    metadata: Record<string, any> = {},
    confidence = 0.9,
    usage?: Record<string, any>
  ): AgentResult {
    return {
      agentType: this.agentType,
      analysis,
      confidence,
      metadata: usage ? { ...metadata, usage } : metadata,
      timestamp: new Date(),
    };
  }

  protected reportProgress(cb: AgentProgressCallback | undefined, stage: AgentProgressStage, result?: AgentResult, error?: Error) {
    try { cb?.(this.agentType, stage, result, error); } catch { /* no-op */ }
  }

  protected async callClaude(
    prompt: string,
    claudeClient: ClaudeClient,
    options?: ClaudeCallOptions
  ) {
    const start = Date.now();
    console.log(`🤖 ${this.agentType}: calling Claude...`);
    
    try {
      const result = await claudeClient.makeRequest(prompt, undefined, options);
      const duration = Date.now() - start;
      console.log(`🤖 ${this.agentType}: Claude responded in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.log(`🤖 ${this.agentType}: Claude failed after ${duration}ms`);
      throw error;
    }
  }
}