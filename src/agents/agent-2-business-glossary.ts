// agents/agent-2-business-glossary.ts
import { BaseAgent, AgentResult, AgentContext, AgentProgressCallback } from './base-agent';
import { ClaudeClient } from '../claude-config';

type GlossaryJson = {
  overview: {
    domain: string;
    primaryUse: string;            // ≤ 20 words
    stakeholders: string[];        // short role names
    categories: string[];          // DisplayFolder-style groupings
    notes: string[];               // ≤ 20 words each
  };
  terms: Array<{
    term: string;                  // measure/table/column name
    kind: "measure" | "table" | "column" | "concept";
    definition: string;            // ≤ 30 words, plain English
    howToUse?: string;             // ≤ 25 words, when/how to use
    indicators?: string[];         // short success/health indicators
    pitfalls?: string[];           // common misunderstandings
    related?: string[];            // related terms by name
  }>;
  metricQuickRef: Array<{
    name: string;                  // measure name
    definition: string;            // plain English, ≤ 25 words
    whenToUse: string;             // ≤ 20 words
    successIndicators: string[];   // 1–3 items
  }>;
  confidence: number;              // 0..1
};

export class BusinessGlossaryAgent extends BaseAgent {
  constructor() {
    super('Business Glossary & Terminology');
  }

  async analyze(
    context: AgentContext,
    claudeClient: ClaudeClient,
    progressCallback?: AgentProgressCallback
  ): Promise<AgentResult> {
    this.reportProgress(progressCallback, 'started');

    try {
      const prompt = this.buildPrompt(context);
      const response = await this.callClaude(prompt, claudeClient);

      if (!response.success || !response.data) {
        throw new Error(`Claude API failed: ${response.error}`);
      }

      // normalise to JSON string for downstream
      const json = this.ensureJsonString(response.data, this.emptyPayload(context));
      const parsed = this.safeParse(json) as GlossaryJson;

      const result = this.createResult(
        json,
        {
          domainContext: context.domain,
          keyTerms: parsed?.terms?.map(t => t.term) ?? [],
          businessCategories: parsed?.overview?.categories ?? [],
          stakeholderGlossary: {
            stakeholders: parsed?.overview?.stakeholders ?? []
          }
        },
        Math.min(0.97, Number(parsed?.confidence ?? 0.9)),
        response.usage
      );

      this.reportProgress(progressCallback, 'completed', result);
      return result;

    } catch (error) {
      this.reportProgress(progressCallback, 'error', undefined, error as Error);
      throw error;
    }
  }

  protected buildPrompt(context: AgentContext): string {
    const measures = (context.measures || []).slice(0, 50);
    const tables = (context.tables || []).slice(0, 50);
    const columns = (context.columns || []).slice(0, 100);

    const measureNames = measures.map(m => m.name || m.MeasureName).filter(Boolean);
    const tableNames = tables.map(t => t.name || t.TableName).filter(Boolean);
    const columnNames = columns.map(c => `${c.tableName || c.TableName}[${c.name || c.ColumnName}]`).filter(Boolean);
    const categories = Array.from(
      new Set(
        measures.map(m => (m.displayFolder || m.DisplayFolder || '').trim()).filter(Boolean)
      )
    );

    const inputs = JSON.stringify({
      domain: context.domain || 'Business Intelligence',
      stakeholders: context.stakeholders || [],
      measures: measureNames,
      tables: tableNames,
      columns: columnNames.slice(0, 120),
      categories
    });

    const schema = {
      type: "object",
      properties: {
        overview: {
          type: "object",
          properties: {
            domain: { type: "string" },
            primaryUse: { type: "string" },
            stakeholders: { type: "array", items: { type: "string" } },
            categories: { type: "array", items: { type: "string" } },
            notes: { type: "array", items: { type: "string" } }
          },
          required: ["domain","primaryUse","stakeholders","categories","notes"]
        },
        terms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              term: { type: "string" },
              kind: { enum: ["measure","table","column","concept"] },
              definition: { type: "string" },
              howToUse: { type: "string" },
              indicators: { type: "array", items: { type: "string" } },
              pitfalls: { type: "array", items: { type: "string" } },
              related: { type: "array", items: { type: "string" } }
            },
            required: ["term","kind","definition"]
          }
        },
        metricQuickRef: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              definition: { type: "string" },
              whenToUse: { type: "string" },
              successIndicators: { type: "array", items: { type: "string" } }
            },
            required: ["name","definition","whenToUse","successIndicators"]
          }
        },
        confidence: { type: "number" }
      },
      required: ["overview","terms","metricQuickRef","confidence"]
    };

    return `
SYSTEM:
You are a precise documentation writer. Output MUST be a single JSON object matching SCHEMA.
Only use details present in the supplied model metadata. Do NOT invent business processes, industry terms, or dataset specifics.
Return the specified JSON schema. If a field is unknown, leave it blank; do not guess.
No emojis. UK English. Keep definitions concise and practical.

SCHEMA:
${JSON.stringify(schema)}

INPUTS (trusted JSON):
${inputs}

GUIDELINES:
- "terms": include all measure names and notable tables; include columns only if they convey business meaning.
- Definitions ≤ 30 words, plain English, no DAX.
- "howToUse" focuses on when it’s relevant (cadence, audience).
- "indicators": 1–3 short signals of good/poor performance (avoid numeric thresholds unless obvious from names).
- "pitfalls": common misunderstandings (short, factual).
- "metricQuickRef": build from measures; definition ≤ 25 words; whenToUse ≤ 20 words.
- "overview.primaryUse": ≤ 20 words.
- "notes": 2–6 bullets, ≤ 20 words each.

OUTPUT:
Return ONLY the JSON object conforming to SCHEMA.
`.trim();
  }

  // ---------- Orchestrator helper ----------

  extractBusinessTerms(result: AgentResult): Record<string, any> {
    const obj = this.safeParse(String(result.analysis)) as Partial<GlossaryJson> | null;
    return {
      keyTerms: obj?.terms?.map(t => t.term) ?? [],
      domainConcepts: (obj?.terms || []).filter(t => t.kind === 'concept').map(t => t.term),
      stakeholderGlossary: { stakeholders: obj?.overview?.stakeholders ?? [] },
      businessCategories: obj?.overview?.categories ?? []
    };
  }

  // ---------- Utilities ----------

  private emptyPayload(context: AgentContext): GlossaryJson {
    return {
      overview: {
        domain: context.domain || 'Business Intelligence',
        primaryUse: '',
        stakeholders: Array.isArray(context.stakeholders) ? context.stakeholders : [],
        categories: [],
        notes: []
      },
      terms: [],
      metricQuickRef: [],
      confidence: 0.85
    };
  }

  private ensureJsonString(raw: unknown, fallbackObj: any): string {
    const s = typeof raw === 'string' ? raw : (() => { try { return JSON.stringify(raw ?? ''); } catch { return String(raw ?? ''); } })();
    // direct
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v);
    } catch { /* ignore */ }
    // remove fences
    const noFences = s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/,'');
    try {
      const v2 = JSON.parse(noFences);
      if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) return JSON.stringify(v2);
    } catch { /* ignore */ }
    // last {...}
    const m = noFences.match(/\{[\s\S]*\}$/);
    if (m) {
      try { return JSON.stringify(JSON.parse(m[0])); } catch { /* ignore */ }
    }
    return JSON.stringify(fallbackObj);
  }

  private safeParse(s: string): any | null {
    try { return JSON.parse(s); } catch { return null; }
  }
}
