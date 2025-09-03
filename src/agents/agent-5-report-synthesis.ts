// agents/agent-5-report-synthesis.ts
import { BaseAgent, AgentResult, AgentContext, AgentProgressCallback } from './base-agent';
import { ClaudeClient } from '../claude-config';
import { heuristicDescribe } from '../lib/measure-heuristics';
import { enrichMeasures } from '../lib/measure-enricher';

export interface SynthesisInput {
  domainAnalysis: AgentResult;
  businessGlossary: AgentResult;
  dataArchitecture: AgentResult;
  daxAnalysis: AgentResult;
}

/**
 * ReportSynthesisAgent
 * - Consumes outputs from Agents 1..4
 * - Produces STRICT JSON with a stable shape for the web app:
 *   {
 *     "overview": {...},
 *     "measures": [...],
 *     "tables": [...],
 *     "relationships": [...],
 *     "lintFindings": [...]
 *   }
 */
export class ReportSynthesisAgent extends BaseAgent {
  constructor() {
    super('Report Synthesis & Orchestration');
  }

  // Legacy entry point (kept for compatibility); prefer synthesizeResults(...)
  async analyze(context: AgentContext, claudeClient: ClaudeClient, progressCallback?: AgentProgressCallback): Promise<AgentResult> {
    this.reportProgress(progressCallback, 'started');
    try {
      const prompt = this.buildPrompt(context);
      const response = await this.callClaude(prompt, claudeClient);

      if (!response.success || !response.data) {
        throw new Error(`Claude API failed: ${response.error}`);
      }

      // Ensure payload is JSON for downstream UI
      const normalized = this.ensureJsonString(response.data, {
        overview: {},
        measures: [],
        tables: [],
        relationships: [],
        lintFindings: []
      });

      const result = this.createResult(
        normalized,
        { domainContext: context.domain, note: 'analyze() used; prefer synthesizeResults() for full fidelity' },
        0.90,
        response.usage
      );
      this.reportProgress(progressCallback, 'completed', result);
      return result;
    } catch (error) {
      this.reportProgress(progressCallback, 'error', undefined, error as Error);
      throw error;
    }
  }

  /**
   * Preferred entry point that feeds structured inputs + context and enforces strict JSON output.
   */
  async synthesizeResults(inputs: SynthesisInput, context: AgentContext, claudeClient?: ClaudeClient): Promise<AgentResult> {
    if (!claudeClient) throw new Error('Claude client required for synthesis');

    // Extract/normalise upstream content before prompting
    const domainSummary = this.safeString(inputs.domainAnalysis?.analysis);
    const glossarySummary = this.safeString(inputs.businessGlossary?.analysis);
    const architectureSummary = this.safeString(inputs.dataArchitecture?.analysis);

    // DAX analysis from Agent-4 should already be a JSON array of objects;
    // but we defend against prose or fenced blocks.
    const daxItems = this.safeParseJsonArray(inputs.daxAnalysis?.analysis);
    const lintFindingsFromA4: string[] = Array.isArray(inputs.daxAnalysis?.metadata?.lintSummary)
      ? inputs.daxAnalysis?.metadata?.lintSummary as string[]
      : [];

    // Model objects from context (optional if available)
    const tables = (context.tables || []).map((t: any) => ({
      name: t.name || t.TableName,
      category: t.category || t.Category || 'Regular',
      columns: Number(t.columnCount || t.ColumnCount || t.columns?.length || 0),
      summary: t.description || t.Description || ''
    }));

    const relationships = (context.relationships || []).map((r: any) => ({
      from: `${r.fromTable || r.FromTable || r.tableFrom || r.TableFrom || r.Table1}[${r.fromColumn || r.FromColumn || r.ColumnFrom || r.Column1}]`,
      to: `${r.toTable || r.ToTable || r.tableTo || r.TableTo || r.Table2}[${r.toColumn || r.ToColumn || r.ColumnTo || r.Column2}]`,
      cardinality: r.cardinality || r.Cardinality || 'Many-to-One',
      direction: r.crossFilterDirection || r.CrossFilterDirection || 'Single'
    }));

    // Build strict JSON prompt
    const prompt = this.buildSynthesisPrompt({
      businessDomain: this.extractDomainName(domainSummary) || (context.domain || 'Business Intelligence'),
      domainSummary,
      glossarySummary,
      architectureSummary,
      daxItems,
      tables,
      relationships,
      lintFindingsFromA4
    });

    // Call model
    const response = await this.callClaude(prompt, claudeClient);

    if (!response.success || !response.data) {
      throw new Error(`Claude API failed: ${response.error}`);
    }

    // Parse and merge glossary fields into synthesized measures BEFORE coercion
    const raw = response.data; // model's JSON string
    let obj: any;
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = { measures: [] }; }

    // Parse glossary JSON produced by Agent 2
    let glossary: any = {};
    try {
      glossary = JSON.parse(String(inputs.businessGlossary.analysis));
    } catch {}

    const quickRef: any[] = glossary.metricQuickRef || [];
    const glossByName = new Map<string, any>();
    quickRef.forEach(g => glossByName.set(String(g.name || g.term).toLowerCase(), g));

    // Merge: for each synthesized measure, backfill businessMeaning/whenToUse/successIndicators
    (obj.measures || []).forEach((m: any) => {
      const g = glossByName.get(String(m.name).toLowerCase());
      if (g) {
        m.businessMeaning   = m.businessMeaning   || g.definition || '';
        m.whenToUse        = m.whenToUse        || g.whenToUse || '';
        m.successIndicators= m.successIndicators|| (Array.isArray(g.successIndicators) ? g.successIndicators.join(', ') : '');
      }
    });

    // Re-serialize so downstream sees the enriched fields
    response.data = JSON.stringify(obj);

    // Coerce the response to ensure complete structure
    const coerced = this.coerceSynthesis(response.data, inputs, context);

    // Enrich measures with heuristics before returning
    let glossaryObj: any = {};
    try { glossaryObj = JSON.parse(String(inputs.businessGlossary.analysis)); } catch { /* ignore */ }

    const enriched = enrichMeasures(
      (coerced.measures || []).map((m: any) => ({
        name: String(m.name || ''),
        expression: String(m.dax || m.expression || ''),
        displayFolder: String(m.folder || ''),
        description: String(m.description || ''),
        formatString: String(m.formatString || '')
      })),
      glossaryObj
    );

    // Merge enriched fields back without overwriting existing non-empty values
    coerced.measures = (coerced.measures || []).map((m: any) => {
      const e = enriched.find(x => x.name.toLowerCase() === String(m.name || '').toLowerCase());
      if (!e) return m;
      return {
        ...m,
        businessMeaning: m.businessMeaning || e.purpose,
        whenToUse: m.whenToUse || e.whenToUse,
        successIndicators: (Array.isArray(m.successIndicators) && m.successIndicators.length) ? m.successIndicators : e.successIndicators,
        risks: (Array.isArray(m.risks) && m.risks.length) ? m.risks : e.risks,
        dax: m.dax || e.dax,
        folder: m.folder || e.folder,
        description: m.description || e.description,
        formatString: m.formatString || e.formatString
      };
    });

    return this.createResult(
      JSON.stringify(coerced),
      {
        inputSources: {
          domain: inputs.domainAnalysis.agentType,
          glossary: inputs.businessGlossary.agentType,
          architecture: inputs.dataArchitecture.agentType,
          dax: inputs.daxAnalysis.agentType
        },
        synthesisApproach: 'Schema-first integration',
        domainContext: context.domain
      },
      0.94,
      response.usage
    );
  }

  // ---------- Prompt builders ----------

  protected buildPrompt(context: AgentContext): string {
    // Simple legacy prompt; kept for compatibility but prefers strict JSON now.
    const schema = this.schemaText();
    const measuresCount = context.measures?.length || 0;
    const tablesCount = context.tables?.length || 0;
    const relCount = context.relationships?.length || 0;

    return `
SYSTEM:
You produce ONLY valid JSON that conforms to the schema below. No extra prose.

SCHEMA:
${schema}

CONTEXT:
- Domain: ${context.domain || 'Power BI Data Model'}
- Measures: ${measuresCount}
- Tables: ${tablesCount}
- Relationships: ${relCount}

TASK:
Return a JSON object conforming to SCHEMA that summarises the model for business & technical audiences.
Descriptions must be concise and factual. No emojis. Keep each description ≤ 120 words.
`.trim();
  }

  private buildSynthesisPrompt(data: {
    businessDomain: string;
    domainSummary: string;
    glossarySummary: string;
    architectureSummary: string;
    daxItems: any[]; // from Agent-4 JSON array
    tables: Array<{ name: string; category: string; columns: number; summary?: string }>;
    relationships: Array<{ from: string; to: string; cardinality: string; direction: string }>;
    lintFindingsFromA4: string[];
  }): string {
    const schema = this.schemaText();

    // We inline compact JSON for deterministic grounding
    const inputsJson = JSON.stringify({
      businessDomain: data.businessDomain,
      summaries: {
        domain: this.truncate(data.domainSummary, 1200),
        glossary: this.truncate(data.glossarySummary, 1200),
        architecture: this.truncate(data.architectureSummary, 1200)
      },
      daxItems: data.daxItems.slice(0, 999), // safety guard
      tables: data.tables,
      relationships: data.relationships,
      lintFindingsFromA4: data.lintFindingsFromA4
    });

    return `
SYSTEM:
You are a precise report synthesizer. **Return ONLY valid JSON** with keys: overview{domain,tables,measures,relationships,stakeholders,notes}, measures[], tables[], relationships[], lintFindings[]. No markdown or prose.
Only use details present in the supplied model metadata. Do NOT invent business processes, industry terms, or dataset specifics.
Return the specified JSON schema. If a field is unknown, leave it blank; do not guess.
Keep wording concise and business-friendly; avoid hype.
No emojis, no markdown, no code fences.
INCLUDE ALL measures from daxItems array - do not filter or select subset.

SCHEMA:
${schema}

INPUTS (trusted JSON):
${inputsJson}

GUIDELINES:
- "overview" should summarise domain, counts, stakeholders (if visible in summaries), and key notes.
- "measures" MUST map every item from INPUTS.daxItems array. For each daxItem: {name: daxItem.measureName, purpose: daxItem.purpose, formula: daxItem.formula, complexity: daxItem.complexity, risks: daxItem.risks || [], fixes: daxItem.suggestedFixes || []}
- "tables" and "relationships" must use the arrays provided in INPUTS (you may rewrite summaries, not names).
- "lintFindings" should include INPUTS.lintFindingsFromA4 plus any high-confidence issues observed in daxItems. Do not invent.
- All fields required by SCHEMA must be present, even if empty arrays.
- CRITICAL: The "measures" array must contain exactly ${data.daxItems.length} items, one for each item in INPUTS.daxItems.
- MANDATORY: Transform each daxItem into a measure object - do not skip any.

OUTPUT:
Return ONLY the JSON object conforming to SCHEMA. No additional text.
`.trim();
  }

  // ---------- Utilities ----------

  private schemaText(): string {
    // Keep schema small & stable for the web app.
    return JSON.stringify({
      type: "object",
      properties: {
        overview: {
          type: "object",
          properties: {
            domain: { type: "string" },
            tables: { type: "number" },
            measures: { type: "number" },
            relationships: { type: "number" },
            stakeholders: { type: "array", items: { type: "string" } },
            notes: { type: "array", items: { type: "string" } }
          },
          required: ["domain", "tables", "measures", "relationships"]
        },
        measures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              purpose: { type: "string" },
              formula: { type: "string" },
              complexity: { enum: ["simple", "medium", "complex"] },
              risks: { type: "array", items: { type: "string" } },
              fixes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    rationale: { type: "string" },
                    fixedDax: { type: "string" }
                  },
                  required: ["title", "fixedDax"]
                }
              }
            },
            required: ["name", "purpose", "formula", "complexity"]
          }
        },
        tables: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              category: { type: "string" },
              columns: { type: "number" },
              summary: { type: "string" }
            },
            required: ["name", "category", "columns"]
          }
        },
        relationships: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              cardinality: { type: "string" },
              direction: { type: "string" }
            },
            required: ["from", "to", "cardinality", "direction"]
          }
        },
        lintFindings: { type: "array", items: { type: "string" } }
      },
      required: ["overview", "measures", "tables", "relationships", "lintFindings"]
    }, null, 2);
  }

  private extractDomainName(text: string): string | null {
    const m = text.match(/(?:DOMAIN|BUSINESS DOMAIN|PRIMARY DOMAIN)[:\s\-]*([A-Za-z0-9 &/]+)\b/i);
    return m ? m[1].trim() : null;
  }

  private ensureJsonString(raw: unknown, fallbackObj: any): string {
    const s = this.safeString(raw);
    // Try direct parse
    const p = this.safeParseJsonObject(s);
    if (p) return JSON.stringify(p);
    // Try extracting final {...}
    const lastObj = this.extractLastJsonObject(s);
    if (lastObj) return JSON.stringify(lastObj);
    // Fallback
    return JSON.stringify(fallbackObj);
  }

  private safeString(v: unknown): string {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v ?? ''); } catch { return String(v ?? ''); }
  }

  private safeParseJsonObject(s: string): any | null {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch { return null; }
  }

  private safeParseJsonArray(s: unknown): any[] {
    const str = this.safeString(s).trim();
    // direct parse
    try { const v = JSON.parse(str); if (Array.isArray(v)) return v; } catch {}
    // strip fences
    const noFences = str.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try { const v2 = JSON.parse(noFences); if (Array.isArray(v2)) return v2; } catch {}
    // try to find last [...] block
    const m = noFences.match(/\[[\s\S]*\]$/);
    if (m) { try { const v3 = JSON.parse(m[0]); if (Array.isArray(v3)) return v3; } catch {} }
    return [];
  }

  private extractLastJsonObject(s: string): any | null {
    const m = s.match(/\{[\s\S]*\}$/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }

  private truncate(s: string, n: number): string {
    if (!s || s.length <= n) return s;
    return s.slice(0, n) + '…';
  }

  // Optional: generate a small structured summary for CLIs
  generateReportStructure(result: AgentResult): Record<string, any> {
    const obj = this.safeParseJsonObject(this.safeString(result.analysis)) || {};
    return {
      reportType: 'Comprehensive DAX Catalog',
      overview: obj.overview || {},
      counts: {
        measures: Array.isArray(obj.measures) ? obj.measures.length : 0,
        tables: Array.isArray(obj.tables) ? obj.tables.length : 0,
        relationships: Array.isArray(obj.relationships) ? obj.relationships.length : 0
      },
      lintFindingsCount: Array.isArray(obj.lintFindings) ? obj.lintFindings.length : 0,
      overallConfidence: result.confidence
    };
  }

  // Add these methods inside ReportSynthesisAgent class
  private parseJson<T>(v: unknown, fallback: T): T {
    try { return typeof v === 'string' ? JSON.parse(v) as T : (v as T); }
    catch { return fallback; }
  }

  private coerceSynthesis(
    raw: unknown,
    inputs: SynthesisInput,
    context: AgentContext
  ) {
    const obj: any = this.parseJson<any>(raw, {});
    obj.overview = obj.overview || {};
    obj.overview.domain        = obj.overview.domain        || (inputs.domainAnalysis.metadata?.domain || context.domain || 'Business Intelligence');
    obj.overview.tables        = Number.isFinite(obj.overview.tables)        ? obj.overview.tables        : (context.tables?.length || 0);
    obj.overview.measures      = Number.isFinite(obj.overview.measures)      ? obj.overview.measures      : (context.measures?.length || 0);
    obj.overview.relationships = Number.isFinite(obj.overview.relationships) ? obj.overview.relationships : (context.relationships?.length || 0);

    // Build column counts per table from context
    const colCounts = new Map<string, number>();
    (context.columns || []).forEach(c => {
      const key = (c.tableName || '').toLowerCase();
      colCounts.set(key, (colCounts.get(key) || 0) + 1);
    });

    // Ensure tables array with real column counts
    if (!Array.isArray(obj.tables) || obj.tables.length === 0) {
      obj.tables = (context.tables || []).map(t => ({
        name: t.name,
        category: 'Regular',
        columns: colCounts.get((t.name || '').toLowerCase()) || 0,
        summary: t.description || ''
      }));
    } else {
      obj.tables = obj.tables.map((t: any) => ({
        ...t,
        columns: colCounts.get((t.name || '').toLowerCase()) || t.columns || 0
      }));
    }

    // Ensure relationships present
    if (!Array.isArray(obj.relationships) || obj.relationships.length === 0) {
      obj.relationships = (context.relationships || []).map(r => ({
        from: `${r.fromTable}[${r.fromColumn}]`,
        to: `${r.toTable}[${r.toColumn}]`,
        cardinality: r.cardinality || 'Many-to-One',
        direction: 'Single'
      }));
    }

    // Ensure measures present with heuristic fallbacks
    if (!Array.isArray(obj.measures) || obj.measures.length === 0) {
      obj.measures = (context.measures || []).map(m => {
        const h = heuristicDescribe({
          name: m.name || m.MeasureName,
          expression: (m as any).expression || m.Expression,
          displayFolder: (m as any).displayFolder || m.DisplayFolder,
          description: m.description || m.Description
        });
        return {
          name: m.name,
          businessMeaning: h.purpose,
          whenToUse: h.whenToUse,
          successIndicators: h.successIndicators,
          dax: (m as any).expression || '',
          folder: (m as any).displayFolder || '',
          description: (m as any).description || ''
        };
      });
    } else {
      // Merge heuristics for measures with missing business context
      obj.measures = (obj.measures || []).map((m: any) => {
        const h = heuristicDescribe({
          name: m.name,
          expression: m.dax || m.expression || '',
          displayFolder: m.folder || '',
          description: m.description || ''
        });
        return {
          ...m,
          businessMeaning: m.businessMeaning || h.purpose,
          whenToUse: m.whenToUse || h.whenToUse,
          successIndicators: Array.isArray(m.successIndicators) && m.successIndicators.length ? m.successIndicators : h.successIndicators,
          risks: Array.isArray(m.risks) && m.risks.length ? m.risks : h.risks
        };
      });
    }

    // Keep lintFindings if present; else preserve inputs'
    obj.lintFindings = obj.lintFindings || inputs.daxAnalysis?.metadata?.lintFindings || [];

    return obj;
  }
}
