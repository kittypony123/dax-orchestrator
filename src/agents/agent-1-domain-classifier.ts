// agents/agent-1-domain-classifier.ts
import { BaseAgent, AgentResult, AgentContext, AgentProgressCallback } from './base-agent';
import { ClaudeClient } from '../claude-config';

type DomainJson = {
  domain: string;                         // e.g., "Transportation Analytics"
  executiveSummary: {
    purpose: string;                      // ≤ 30 words
    users: string[];                      // primary stakeholder types
    value: string[];                      // 2–3 business outcomes
    decisions: string[];                  // decisions supported
  };
  stakeholders: {
    primary: string[];
    management: string[];
    support: string[];
  };
  businessProcesses: string[];            // e.g., ["Trip Planning", "Asset Utilisation"]
  signals: {
    fromMeasures: string[];               // short signals inferred safely from measure names only
    fromTables: string[];                 // short signals inferred safely from table names only
  };
  notes: string[];                        // short factual notes (≤ 20 words each)
  confidence: number;                     // 0..1
};

export class DomainClassifierAgent extends BaseAgent {
  constructor() {
    super('Domain Classifier');
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

      // normalise to JSON string for downstream use
      const json = this.ensureJsonString(response.data, this.emptyPayload(context));
      const parsed = this.safeParseJson(json) as DomainJson;

      // Confidence gating: accept only specific domains, fallback to generic
      const specific = parsed.domain && !/^(business intelligence|unknown|analytics)$/i.test(parsed.domain);
      const finalDomain = specific ? parsed.domain : 'Analytics Model';

      // Stakeholders: generic fallback if none supplied
      const extractedStakeholders = [
        ...(parsed.stakeholders?.primary ?? []),
        ...(parsed.stakeholders?.management ?? []),
        ...(parsed.stakeholders?.support ?? [])
      ].filter(Boolean);
      
      const finalStakeholders = extractedStakeholders.length > 0 
        ? extractedStakeholders
        : ['Executives', 'Business Owners', 'Analysts', 'BI Developers'];

      const result = this.createResult(
        json,
        {
          domain: finalDomain,
          stakeholders: finalStakeholders,
          businessContext: parsed.executiveSummary?.purpose,
          inputData: {
            measuresCount: context.measures?.length || 0,
            tablesCount: context.tables?.length || 0,
            columnsCount: context.columns?.length || 0,
            relationshipsCount: context.relationships?.length || 0
          }
        },
        Math.min(0.98, Number(parsed.confidence ?? 0.9)),
        response.usage
      );

      this.reportProgress(progressCallback, 'completed', result);
      return result;

    } catch (error) {
      // Graceful fallback when AI is unavailable (e.g., missing API key)
      const fb = this.fallbackFromContext(context);
      const json = JSON.stringify(fb);
      const result = this.createResult(
        json,
        {
          domain: fb.domain,
          stakeholders: [
            ...fb.stakeholders.primary,
            ...fb.stakeholders.management,
            ...fb.stakeholders.support
          ],
          businessContext: fb.executiveSummary.purpose,
          inputData: {
            measuresCount: context.measures?.length || 0,
            tablesCount: context.tables?.length || 0,
            columnsCount: context.columns?.length || 0,
            relationshipsCount: context.relationships?.length || 0
          },
          fallback: true,
          reason: (error as Error)?.message || String(error)
        },
        0.3
      );
      this.reportProgress(progressCallback, 'completed', result);
      return result;
    }
  }

  // ---------- Prompt (schema-first, no chain-of-thought) ----------

  protected buildPrompt(context: AgentContext): string {
    const measures = (context.measures || []).slice(0, 12);
    const tables = (context.tables || []).map(t => t.name || t.TableName);

    const sampleMeasures = measures.map(m => ({
      name: m.name || m.MeasureName || '',
      // names only (avoid leaking large formulas & reduce hallucinations)
      // include first 80 chars of expression purely as a weak hint (optional)
      hint: String(m.expression || m.Expression || '').slice(0, 80)
    }));

    const schema = {
      type: "object",
      properties: {
        domain: { type: "string" },
        executiveSummary: {
          type: "object",
          properties: {
            purpose: { type: "string" },
            users: { type: "array", items: { type: "string" } },
            value: { type: "array", items: { type: "string" } },
            decisions: { type: "array", items: { type: "string" } }
          },
          required: ["purpose", "users", "value", "decisions"]
        },
        stakeholders: {
          type: "object",
          properties: {
            primary: { type: "array", items: { type: "string" } },
            management: { type: "array", items: { type: "string" } },
            support: { type: "array", items: { type: "string" } }
          },
          required: ["primary","management","support"]
        },
        businessProcesses: { type: "array", items: { type: "string" } },
        signals: {
          type: "object",
          properties: {
            fromMeasures: { type: "array", items: { type: "string" } },
            fromTables: { type: "array", items: { type: "string" } }
          },
          required: ["fromMeasures","fromTables"]
        },
        notes: { type: "array", items: { type: "string" } },
        confidence: { type: "number" }
      },
      required: ["domain","executiveSummary","stakeholders","businessProcesses","signals","notes","confidence"]
    };

    const inputs = JSON.stringify({
      hint: "Infer only from names and obvious cues. Do not invent data.",
      tables,
      measures: sampleMeasures
    });

    return `
SYSTEM:
You are a precise business domain classifier. Output MUST be a single JSON object that matches SCHEMA.
Do NOT provide reasoning or chain-of-thought. Do NOT add unverifiable facts. UK English. No emojis.

SCHEMA (authoritative):
${JSON.stringify(schema)}

INPUTS (trusted JSON):
${inputs}

GUIDELINES:
- Base the domain and processes on obvious naming patterns only.
- If you're not at least 0.7 confident about a specific industry, label the domain as "Analytics Model" and return a generic stakeholder set.
- Executive summary purpose ≤ 30 words, concrete and jargon-light.
- "value" must list 2–3 outcomes; "decisions" 2–4 concise items.
- Stakeholder arrays: short, role-like strings ("Analyst", "Ops Manager").
- "signals" should be short phrases justified only by names (e.g., "Has Calendar table", "Weather features present").
- "notes": 2–6 brief bullets (≤ 20 words each).
- Set "confidence" conservatively 0.7–0.98.

OUTPUT:
Return ONLY the JSON object. No markdown, no extra text.
`.trim();
  }

  // ---------- Context extraction for orchestrator ----------

  extractDomainContext(result: AgentResult): AgentContext {
    // prefer structured JSON from analysis
    const obj = this.safeParseJson(String(result.analysis)) as Partial<DomainJson> | null;
    if (obj) {
      return {
        domain: obj.domain || 'Business Intelligence',
        stakeholders: [
          ...(obj.stakeholders?.primary ?? []),
          ...(obj.stakeholders?.management ?? []),
          ...(obj.stakeholders?.support ?? [])
        ].filter(Boolean),
        businessContext: obj.executiveSummary?.purpose || ''
      };
    }
    // fallback to metadata (should exist if analyze() succeeded)
    return {
      domain: String(result.metadata?.domain || 'Business Intelligence'),
      stakeholders: (result.metadata?.stakeholders as string[]) || [],
      businessContext: String(result.metadata?.businessContext || '')
    };
  }

  // ---------- Utilities ----------

  private emptyPayload(ctx: AgentContext): DomainJson {
    return {
      domain: ctx.domain || 'Business Intelligence',
      executiveSummary: { purpose: '', users: [], value: [], decisions: [] },
      stakeholders: { primary: [], management: [], support: [] },
      businessProcesses: [],
      signals: { fromMeasures: [], fromTables: [] },
      notes: [],
      confidence: 0.8
    };
  }

  private ensureJsonString(raw: unknown, fallbackObj: any): string {
    const s = typeof raw === 'string' ? raw : (() => { try { return JSON.stringify(raw ?? ''); } catch { return String(raw ?? ''); } })();
    // direct object
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v);
    } catch { /* ignore */ }
    // code fences
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

  private safeParseJson(s: string): any | null {
    try { return JSON.parse(s); } catch { return null; }
  }

  private fallbackFromContext(ctx: AgentContext): DomainJson {
    const tblNames = (ctx.tables || []).map((t: any) => String(t.name || t.TableName || ''));
    const measNames = (ctx.measures || []).map((m: any) => String(m.name || m.MeasureName || ''));

    const hasCalendar = tblNames.some(n => /calendar|date/i.test(n));
    const hasSales = tblNames.some(n => /sale|order|invoice/i.test(n));
    const hasFinance = tblNames.some(n => /financ|ledger|account/i.test(n));

    const domain = hasSales ? 'Sales Analytics'
      : hasFinance ? 'Financial Analytics'
      : 'Analytics Model';

    const processes: string[] = [];
    if (hasSales) processes.push('Sales Performance');
    if (hasFinance) processes.push('Financial Reporting');
    if (hasCalendar) processes.push('Time Intelligence');

    const signals = {
      fromMeasures: measNames.slice(0, 8).map(n => `Measure: ${n}`),
      fromTables: tblNames.slice(0, 8).map(n => `Table: ${n}`)
    };

    return {
      domain,
      executiveSummary: {
        purpose: `Describes core KPIs and relationships across ${tblNames.length} tables and ${measNames.length} measures`,
        users: ['Analysts','Business Owners','BI Developers'],
        value: ['Shared understanding of metrics','Improved decision-making'],
        decisions: ['Prioritise KPIs','Identify data gaps']
      },
      stakeholders: {
        primary: ['Analysts','Ops Manager'],
        management: ['Directors','Leads'],
        support: ['BI Developers']
      },
      businessProcesses: processes.length ? processes : ['Reporting','Analysis'],
      signals,
      notes: ['Generated without AI due to unavailable service'],
      confidence: 0.3
    };
  }
}
