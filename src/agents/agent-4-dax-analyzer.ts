import { BaseAgent, AgentResult, AgentContext, AgentProgressCallback } from './base-agent';
import { ClaudeClient } from '../claude-config';
import { heuristicDescribe } from '../lib/measure-heuristics';
import { lintDax } from '../lib/dax-lint';

type DaxAnalysis = {
  measureName: string;
  purpose: string;
  formula: string;
  dependencies: string[];
  complexity: "simple" | "medium" | "complex";
  risks?: string[];
  antiPatterns?: string[];
  suggestedFixes?: { title: string; rationale?: string; fixedDax: string }[];
  tests?: { scenario: string; expectation: string }[];
  confidence: number;
};

export class DAXAnalyzerAgent extends BaseAgent {
  constructor() {
    super('DAX Analyzer & Measure Interpretation');
  }

  // BaseAgent is abstract; provide a noop buildPrompt (we don't use it here)
  protected buildPrompt(_context: AgentContext): string {
    return 'DAX Analyzer';
  }

  async analyze(
    context: AgentContext,
    claudeClient: ClaudeClient,
    progressCallback?: AgentProgressCallback
  ): Promise<AgentResult> {
    this.reportProgress(progressCallback, 'started');

    try {
      const measures = (context.measures || []).slice(0, (context as any).maxMeasures ?? 999);
      if (!measures.length) throw new Error('No measures found in context.');

      // Generate heuristic fallbacks for all measures first
      const enriched = measures.map(m => {
        const h = heuristicDescribe({
          name: m.name || m.MeasureName,
          expression: m.expression || m.Expression,
          displayFolder: (m as any).displayFolder || m.DisplayFolder,
          description: m.description || m.Description
        });
        return {
          measure: m,
          heuristic: h
        };
      });

      // Per-measure, schema-first prompts → concise and factual
      const requests = enriched.map((item, idx) =>
        this.callClaude(this.buildPromptForMeasure(item.measure, context), claudeClient)
          .then(resp => ({ idx, resp, heuristic: item.heuristic }))
      );

      const settled = await Promise.allSettled(requests);

      const analyses: DaxAnalysis[] = settled.map((s, i) => {
        const fallbackHeuristic = enriched[i].heuristic;
        if (s.status === 'fulfilled') {
          const r = s.value.resp;
          if (!r.success || !r.data) {
            return this.heuristicStub(measures[i], fallbackHeuristic, r.error || 'Claude response missing data');
          }
          const llmResult = this.safeParseJson<DaxAnalysis>(String(r.data));
          // Merge LLM result with heuristic fallbacks for missing fields
          return {
            ...llmResult,
            purpose: llmResult.purpose || fallbackHeuristic.purpose,
            risks: Array.isArray(llmResult.risks) && llmResult.risks.length ? llmResult.risks : fallbackHeuristic.risks,
            dependencies: Array.isArray(llmResult.dependencies) && llmResult.dependencies.length ? llmResult.dependencies : fallbackHeuristic.dependencies
          };
        } else {
          return this.heuristicStub(measures[i], fallbackHeuristic, (s as any).reason);
        }
      });

      // Generic DAX linting for any model
      const lintFindings = measures.flatMap(m => {
        const daxFindings = lintDax(m.expression || (m as any).Expression);
        return daxFindings.map(f => ({ 
          measure: m.name || (m as any).MeasureName, 
          ...f 
        }));
      });

      const result = this.createResult(
        JSON.stringify(analyses, null, 2),
        {
          lintFindings,
          inputData: {
            measuresCount: measures.length,
            analyzed: analyses.length,
            complexMeasures: this.identifyComplexMeasures(measures)
          },
          lintSummary: this.buildLintSummary(analyses)
        },
        0.96
      );

      this.reportProgress(progressCallback, 'completed', result);
      return result;

    } catch (error) {
      this.reportProgress(progressCallback, 'error', undefined, error as Error);
      throw error;
    }
  }

  private failureStub(m: any, err: unknown): DaxAnalysis {
    return {
      measureName: m?.name || m?.MeasureName || 'Unknown',
      purpose: 'Analysis failed.',
      formula: m?.expression || m?.Expression || '',
      dependencies: [],
      complexity: 'medium',
      risks: [`LLM call failed: ${String((err as any)?.message || err)}`],
      confidence: 0.0,
    };
  }

  private heuristicStub(m: any, heuristic: any, err: unknown): DaxAnalysis {
    return {
      measureName: heuristic.name,
      purpose: heuristic.purpose,
      formula: m?.expression || m?.Expression || '',
      dependencies: heuristic.dependencies,
      complexity: 'medium',
      risks: [...heuristic.risks, `LLM analysis unavailable: ${String((err as any)?.message || err)}`],
      confidence: 0.6, // Better than complete failure since we have heuristics
    };
  }

  /** Build a tight, schema-first prompt for one measure. */
  protected buildPromptForMeasure(m: any, context: AgentContext): string {
    const name = m.name || m.MeasureName || 'Unnamed';
    const dax = m.expression || m.Expression || '';
    const displayFolder = (m.displayFolder || m.DisplayFolder) || 'Not specified';
    const description = (m.description || m.Description) || 'No description provided';

    const tables = context.tables || [];
    const columns = context.columns || [];
    const relationships = context.relationships || [];

    // Provide only columns/tables that likely appear in the formula → fewer hallucinations
    const referencedCols = columns
      .filter(c => this.refersTo(dax, `${c.tableName || c.TableName}[${c.name || c.ColumnName}]`))
      .slice(0, 50)
      .map(c => `${c.tableName || c.TableName}[${c.name || c.ColumnName}]`);

    const referencedTables = Array.from(
      new Set(
        tables
          .filter(t => this.refersTo(dax, `${t.name || t.TableName}`))
          .slice(0, 20)
          .map(t => t.name || t.TableName)
      )
    );

    const schema = {
      type: "object",
      properties: {
        measureName: { type: "string" },
        purpose: { type: "string" },
        formula: { type: "string" },
        dependencies: { type: "array", items: { type: "string" } },
        complexity: { enum: ["simple", "medium", "complex"] },
        risks: { type: "array", items: { type: "string" } },
        antiPatterns: { type: "array", items: { type: "string" } },
        suggestedFixes: {
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
        },
        tests: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scenario: { type: "string" },
              expectation: { type: "string" }
            },
            required: ["scenario", "expectation"]
          }
        },
        confidence: { type: "number" }
      },
      required: ["measureName", "purpose", "formula", "dependencies", "complexity", "confidence"]
    };

    const lintChecklist = [
      "Avoid HOUR(MAX(DateTime)); prefer row-level filters with FILTER(ALL(Table), HOUR(Table[DateTime]) IN {...}).",
      "Prefer DIVIDE(n, d) over n/d when denominator might be 0.",
      "Ensure time intelligence uses Calendar table (e.g., DATESINPERIOD(Calendar[Date], ...)).",
      "Flag ambiguous Boolean filters; scope by table to avoid context leakage.",
      "Prefer Date→Date relationships (e.g., Trips[StartDate] → Calendar[Date]) over DateTime→Date."
    ];

    return `
SYSTEM:
You are a senior Power BI DAX reviewer. Be precise, terse, and factual.
Only use details present in the supplied measure metadata and DAX formula. Do NOT invent business processes, industry terms, or dataset specifics.
Return the specified JSON schema. If a field is unknown, leave it blank; do not guess.
If uncertain, produce the minimal valid JSON with "purpose":"Analysis failed".

SCHEMA:
${JSON.stringify(schema)}

MODEL CONTEXT (scoped):
- Referenced Tables: ${referencedTables.join(', ') || '(none detected)'}
- Referenced Columns: ${referencedCols.join(', ') || '(none detected)'}
- Relationships (count): ${relationships.length}

MEASURE:
- Name: ${name}
- Display Folder: ${displayFolder}
- Description: ${description}
- DAX:
${dax}

TASKS:
1) Explain the business purpose in ≤40 words.
2) List explicit dependencies (tables/columns/measures referenced).
3) Set complexity: simple | medium | complex.
4) Apply LINT CHECKLIST; add "risks" and "antiPatterns".
5) If an antiPattern is detected, include at least one "suggestedFix" with corrected DAX and a brief rationale.
6) Add 1–2 micro "tests" (scenario + expectation) for sanity-checking.

LINT CHECKLIST:
- ${lintChecklist.join('\n- ')}

OUTPUT:
Return ONLY valid JSON per SCHEMA. No prose outside JSON.
`.trim();
  }

  private refersTo(text: string, token: string): boolean {
    try {
      return new RegExp(this.escapeRegExp(token), 'i').test(text || '');
    } catch {
      return (text || '').toLowerCase().includes(token.toLowerCase());
    }
  }
  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

  private identifyComplexMeasures(measures: any[]): string[] {
    return measures
      .filter(m => {
        const expr = m.expression || m.Expression || '';
        return /\b(CALCULATE|SUMX|AVERAGEX|FILTER|ADDCOLUMNS|SUMMARIZE|TREATAS|VAR|RETURN|RANKX)\b/i.test(expr);
      })
      .map(m => m.name || m.MeasureName);
  }

  private buildLintSummary(items: DaxAnalysis[]) {
    const findings: string[] = [];
    for (const a of items) {
      if (a?.antiPatterns?.length) findings.push(`${a.measureName}: ${a.antiPatterns.join('; ')}`);
    }
    return findings.slice(0, 100);
  }

  /** Tolerant JSON parser: strips fences / finds first {...} block if needed. */
  private safeParseJson<T>(raw: string): T {
    const text = raw.trim();
    try { return JSON.parse(text) as T; } catch {}
    const noFences = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try { return JSON.parse(noFences) as T; } catch {}
    const m = noFences.match(/\{[\s\S]*\}$/);
    if (m) { try { return JSON.parse(m[0]) as T; } catch {} }
    return JSON.parse('{}') as T;
  }

  // Optional: structured insights for orchestrator dashboards
  extractDAXInsights(result: AgentResult): Record<string, any> {
    let parsed: DaxAnalysis[] = [];
    try { parsed = JSON.parse(String(result.analysis || '[]')); } catch {}
    return {
      complexityBreakdown: parsed.reduce<Record<string, number>>((acc, a) => {
        acc[a.complexity] = (acc[a.complexity] ?? 0) + 1;
        return acc;
      }, {}),
      riskyMeasures: parsed.filter(a => (a?.antiPatterns?.length || 0) > 0).map(a => a.measureName),
      suggestedFixes: parsed.flatMap(a => (a.suggestedFixes || []).map(f => ({ measure: a.measureName, ...f })))
    };
  }
}
