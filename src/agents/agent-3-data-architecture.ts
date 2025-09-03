// agents/agent-3-data-architecture.ts
import { BaseAgent, AgentResult, AgentContext, AgentProgressCallback } from './base-agent';
import { ClaudeClient } from '../claude-config';

type TableRole = "fact" | "dimension" | "bridge" | "calendar" | "junk" | "other";
type Visibility = "visible" | "hidden";

type ArchJson = {
  overview: {
    tables: number;
    columns: number;
    relationships: number;
    schemaType: "Star" | "Snowflake" | "Galaxy" | "Unknown";
    notes: string[]; // short, ≤ 20 words
  };
  tables: Array<{
    name: string;
    role: TableRole;
    rows?: number | null;
    columns: number;
    keys: { primary: string[]; foreign: string[] };
    visibility: Visibility;
    summary: string; // ≤ 30 words
  }>;
  relationships: Array<{
    from: string;          // TableA[Col]
    to: string;            // TableB[Col]
    cardinality: "Many-to-One" | "One-to-Many" | "One-to-One" | "Many-to-Many";
    direction: "Single" | "Both";
    active?: boolean;
  }>;
  lineage: Array<{ source: string; target: string; via?: string }>;
  governance: {
    hiddenTables: string[];
    hiddenColumns: string[];
    dataQualityFlags: string[]; // e.g., "Missing PK on Stations"
    risks: string[];            // e.g., "DateTime->Date relationship may reduce performance"
  };
  issues: string[];             // concise, ≤ 18 words each
  confidence: number;           // 0..1
};

export class DataArchitectureAgent extends BaseAgent {
  constructor() {
    super('Data Architecture Intelligence');
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

      // Normalise to JSON string for downstream consumers
      const json = this.ensureJsonString(response.data, this.emptyPayload(context));
      const parsed = this.safeParse(json) as ArchJson;

      const result = this.createResult(
        json,
        {
          domainContext: context.domain,
          inputData: {
            tablesCount: context.tables?.length || 0,
            columnsCount: context.columns?.length || 0,
            relationshipsCount: context.relationships?.length || 0
          },
          dataModelType: parsed?.overview?.schemaType || 'Unknown',
          keyEntities: parsed?.tables?.map(t => t.name) || [],
          governanceLevel: parsed?.governance?.risks?.length ? 'Needs Review' : 'Standard'
        },
        Math.min(0.96, Number(parsed?.confidence ?? 0.9)),
        response.usage
      );

      this.reportProgress(progressCallback, 'completed', result);
      return result;

    } catch (error) {
      this.reportProgress(progressCallback, 'error', undefined, error as Error);
      throw error;
    }
  }

  // ---------------- Prompt (schema-first, no chain-of-thought) ----------------

  protected buildPrompt(context: AgentContext): string {
    return this.buildDataArchitecturePrompt(context);
  }

  private buildDataArchitecturePrompt(context: AgentContext): string {
    const tables = (context.tables || []).slice(0, 120);
    const columns = (context.columns || []).slice(0, 300);
    const relationships = (context.relationships || []).slice(0, 200);

    const tableSummary = tables.map(t => ({
      name: t.name || t.TableName || '',
      rowCount: Number(t.rowCount ?? t.RowCount ?? NaN),
      columnCount: Number(t.columnCount ?? t.ColumnCount ?? (Array.isArray(t.columns) ? t.columns.length : NaN)),
      description: t.description || t.Description || '',
      isHidden: !!(t.isHidden ?? t.IsHidden)
    }));

    const columnSample = columns.map(c => ({
      table: c.tableName || c.TableName || '',
      name: c.name || c.ColumnName || '',
      dataType: c.dataType || c.DataType || '',
      isHidden: !!(c.isHidden ?? c.IsHidden),
      isKey: /(id$|^id$|key$)/i.test(String(c.name || c.ColumnName || ''))
    }));

    const rels = relationships.map(r => ({
      fromTable: r.fromTable || r.FromTable || r.tableFrom || r.TableFrom || r.Table1 || '',
      fromColumn: r.fromColumn || r.FromColumn || r.ColumnFrom || r.Column1 || '',
      toTable: r.toTable || r.ToTable || r.tableTo || r.TableTo || r.Table2 || '',
      toColumn: r.toColumn || r.ToColumn || r.ColumnTo || r.Column2 || '',
      cardinality: r.cardinality || r.Cardinality || 'Many-to-One',
      direction: r.crossFilterDirection || r.CrossFilterDirection || 'Single',
      active: (typeof r.active === 'boolean') ? r.active : (typeof r.IsActive === 'boolean' ? r.IsActive : true)
    }));

    const inputs = JSON.stringify({
      domain: context.domain || 'Business Intelligence',
      tables: tableSummary,
      columns: columnSample,
      relationships: rels
    });

    const schema = {
      type: "object",
      properties: {
        overview: {
          type: "object",
          properties: {
            tables: { type: "number" },
            columns: { type: "number" },
            relationships: { type: "number" },
            schemaType: { enum: ["Star","Snowflake","Galaxy","Unknown"] },
            notes: { type: "array", items: { type: "string" } }
          },
          required: ["tables","columns","relationships","schemaType","notes"]
        },
        tables: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { enum: ["fact","dimension","bridge","calendar","junk","other"] },
              rows: { type: ["number","null"] },
              columns: { type: "number" },
              keys: {
                type: "object",
                properties: {
                  primary: { type: "array", items: { type: "string" } },
                  foreign: { type: "array", items: { type: "string" } }
                },
                required: ["primary","foreign"]
              },
              visibility: { enum: ["visible","hidden"] },
              summary: { type: "string" }
            },
            required: ["name","role","columns","keys","visibility","summary"]
          }
        },
        relationships: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              cardinality: { enum: ["Many-to-One","One-to-Many","One-to-One","Many-to-Many"] },
              direction: { enum: ["Single","Both"] },
              active: { type: "boolean" }
            },
            required: ["from","to","cardinality","direction"]
          }
        },
        lineage: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: { type: "string" },
              target: { type: "string" },
              via: { type: "string" }
            },
            required: ["source","target"]
          }
        },
        governance: {
          type: "object",
          properties: {
            hiddenTables: { type: "array", items: { type: "string" } },
            hiddenColumns: { type: "array", items: { type: "string" } },
            dataQualityFlags: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } }
          },
          required: ["hiddenTables","hiddenColumns","dataQualityFlags","risks"]
        },
        issues: { type: "array", items: { type: "string" } },
        confidence: { type: "number" }
      },
      required: ["overview","tables","relationships","lineage","governance","issues","confidence"]
    };

    return `
SYSTEM:
You are a precise data architecture summariser. Output MUST be a single JSON object matching SCHEMA.
Only use details present in the supplied model metadata. Do NOT invent business processes, industry terms, or dataset specifics.
Return the specified JSON schema. If a field is unknown, leave it blank; do not guess.
No chain-of-thought, no markdown, no emojis. UK English. Be concise and factual.

SCHEMA:
${JSON.stringify(schema)}

INPUTS (trusted JSON):
${inputs}

GUIDELINES:
- Infer table roles from names, row counts, and relationships: fact (transactional), dimension (lookup), bridge (many-to-many), calendar, junk (degenerate), other.
- Keys: list primary and foreign keys by Column notation (Table[Column]).
- Relationships: use "Table[Column]" form for from/to.
- SchemaType: "Star" (typical fact with multiple dimensions), "Snowflake" (dimensions linked to sub-dimensions), "Galaxy" (multiple facts with shared dimensions), otherwise "Unknown".
- Notes (≤ 20 words each), summaries (≤ 30 words) — avoid speculation.
- Governance: surface hidden tables/columns, ambiguous relationships, DateTime→Date joins, many-to-many, inactive relationships.
- Issues: short, concrete items (≤ 18 words).
- Confidence: 0.7–0.98.

OUTPUT:
Return ONLY the JSON object conforming to SCHEMA.
`.trim();
  }

  // ---------------- Orchestrator helper ----------------

  extractArchitectureInsights(result: AgentResult): Record<string, any> {
    const obj = this.safeParse(String(result.analysis)) as Partial<ArchJson> | null;
    return {
      dataModelType: obj?.overview?.schemaType || 'Unknown',
      keyEntities: (obj?.tables || []).map(t => t.name),
      businessProcesses: [], // Architecture doesn't assert processes; leave to Domain/Glossary
      governanceLevel: (obj?.governance?.risks?.length || 0) ? 'Needs Review' : 'Standard'
    };
  }

  // ---------------- Utilities ----------------

  private emptyPayload(context: AgentContext): ArchJson {
    const t = context.tables?.length || 0;
    const c = context.columns?.length || 0;
    const r = context.relationships?.length || 0;
    return {
      overview: { tables: t, columns: c, relationships: r, schemaType: "Unknown", notes: [] },
      tables: [],
      relationships: [],
      lineage: [],
      governance: { hiddenTables: [], hiddenColumns: [], dataQualityFlags: [], risks: [] },
      issues: [],
      confidence: 0.85
    };
  }

  private ensureJsonString(raw: unknown, fallbackObj: any): string {
    const s = typeof raw === 'string' ? raw : (() => { try { return JSON.stringify(raw ?? ''); } catch { return String(raw ?? ''); } })();
    // direct parse
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v);
    } catch {}
    // strip code fences
    const noFences = s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try {
      const v2 = JSON.parse(noFences);
      if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) return JSON.stringify(v2);
    } catch {}
    // last {...}
    const m = noFences.match(/\{[\s\S]*\}$/);
    if (m) {
      try { return JSON.stringify(JSON.parse(m[0])); } catch {}
    }
    return JSON.stringify(fallbackObj);
  }

  private safeParse(s: string): any | null {
    try { return JSON.parse(s); } catch { return null; }
  }
}
