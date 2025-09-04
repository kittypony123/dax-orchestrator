// agents/agent-6-content-polish.ts
import { BaseAgent, AgentResult, AgentContext, AgentProgressCallback } from './base-agent';
import { ClaudeClient } from '../claude-config';
import { enrichMeasures } from '../lib/measure-enricher';

type PolishingItem = { id: string; text: string; maxWords?: number };
type PolishedPayload = { items: Array<{ id: string; text: string }> };

export class ContentPolishAgent extends BaseAgent {
  constructor() {
    super('Content Polish, UI & Export Generation');
  }

  // BaseAgent requires this; analyze() builds its own prompt, so return noop here.
  protected buildPrompt(_context: AgentContext): string {
    return '';
  }

  async analyze(
    context: AgentContext,
    claudeClient: ClaudeClient,
    progressCallback?: AgentProgressCallback
  ): Promise<AgentResult> {
    try {
      this.reportProgress(progressCallback, 'started');

      // 1) Load raw structured report (JSON) from Agent 5
      const rawObj = this.ensureObject(context.rawReport);
      // Safety: enforce required top-level keys
      const report = this.normaliseShape(rawObj, context);

      // 2) Extract only short, human-readable fields to polish (no structural/technical fields)
      const itemsToPolish = this.collectPolishingItems(report);

      // 3) Ask the model to polish *only* those short texts (no new facts)
      const prompt = this.buildPolishPrompt(itemsToPolish, {
        domain: context.domain,
        stakeholders: context.stakeholders || []
      });

      const resp = await this.callClaude(prompt, claudeClient);
      if (!resp.success || !resp.data) throw new Error(`Claude polish failed: ${resp.error}`);
      const polished: PolishedPayload = this.safeParsePolishedPayload(String(resp.data)) || { items: [] };

      // 4) Merge polished text back
      const polishedReport = this.applyPolish(report, polished);

      // 4.1) Enrich with measure-enricher for guaranteed business context
      const raw = (context as any).rawReport || {};
      const dst = polishedReport || {};
      dst.measures = Array.isArray(dst.measures) ? dst.measures : (raw.measures || []);

      const enriched = enrichMeasures(
        (dst.measures || []).map((m: any) => ({
          name: String(m.name || ''),
          expression: String(m.formula || m.dax || ''),
          displayFolder: String(m.folder || ''),
          description: String(m.description || ''),
          formatString: String(m.formatString || '')
        })),
        (context as any).businessGlossary
      );

      // Fill missing fields only
      dst.measures = (dst.measures || []).map((m: any) => {
        const e = enriched.find(x => x.name.toLowerCase() === String(m.name || '').toLowerCase());
        if (!e) return m;
        return {
          ...m,
          purpose: m.purpose || e.purpose,
          whenToUse: m.whenToUse || e.whenToUse,
          successIndicators: (Array.isArray(m.successIndicators) && m.successIndicators.length) ? m.successIndicators : e.successIndicators,
          risks: (Array.isArray(m.risks) && m.risks.length) ? m.risks : e.risks,
          formula: m.formula || e.dax,
          folder: m.folder || e.folder,
          description: m.description || e.description,
          formatString: m.formatString || e.formatString
        };
      });

      // 4.5) Ensure overview counts use context.stats as fallback
      const stats = (context as any)?.stats || {};
      const overview = polishedReport.overview || {};
      overview.domain        = overview.domain        || (context.domain ?? stats.domain ?? 'Business Intelligence');
      overview.tables        = Number.isFinite(overview.tables)        ? overview.tables        : (stats.tables ?? (context as any).tables?.length ?? 0);
      overview.measures      = Number.isFinite(overview.measures)      ? overview.measures      : (stats.measures ?? (context as any).measures?.length ?? 0);
      overview.relationships = Number.isFinite(overview.relationships) ? overview.relationships : (stats.relationships ?? (context as any).relationships?.length ?? 0);
      overview.stakeholders  = Array.isArray(overview.stakeholders) && overview.stakeholders.length > 0 ? overview.stakeholders : (context?.stakeholders || []);
      polishedReport.overview = overview;

      // 4.6) Complete safety net: Merge from synthesis and glossary into final report
      const src = (context as any).rawReport || {};           // synthesis object
      const synthByName = new Map<string, any>();
      (src.measures || []).forEach((m: any) => synthByName.set(String(m.name).toLowerCase(), m));

      // Optional: if glossary was passed into context, wire it here too
      const glossary = (context as any).businessGlossary || {};
      const quickRef: any[] = glossary.metricQuickRef || [];
      const glossByName = new Map<string, any>();
      quickRef.forEach((g: any) => glossByName.set(String(g.name || g.term).toLowerCase(), g));

      // Ensure measures array exists
      polishedReport.measures = Array.isArray(polishedReport.measures) ? polishedReport.measures : [];
      
      if (!polishedReport.measures.length && Array.isArray(src.measures)) {
        // No measures in final - populate from synthesis
        polishedReport.measures = src.measures.map((m: any) => ({
          name: m.name,
          purpose: m.businessMeaning || '',
          formula: m.dax || '',
          complexity: 'medium',
          risks: [],
          fixes: [],
          whenToUse: m.whenToUse || '',
          successIndicators: Array.isArray(m.successIndicators) ? m.successIndicators.join(', ') : (m.successIndicators || '')
        }));
      } else {
        // Measures exist - enrich with missing business context
        polishedReport.measures = polishedReport.measures.map((m: any) => {
          const key = String(m.name).toLowerCase();
          const s = synthByName.get(key);
          const g = glossByName.get(key);
          return {
            ...m,
            purpose: m.purpose || s?.businessMeaning || g?.definition || '',
            formula: m.formula || s?.dax || '',
            whenToUse: m.whenToUse || s?.whenToUse || g?.whenToUse || '',
            successIndicators: m.successIndicators || (Array.isArray(s?.successIndicators) ? s.successIndicators.join(', ') : s?.successIndicators) || (Array.isArray(g?.successIndicators) ? g.successIndicators.join(', ') : '')
          };
        });
      }

      // 5) Build deterministic UI / Markdown / CSV from JSON (no LLM)
      const uiContent = this.renderHtml(polishedReport);
      const markdownExport = this.renderMarkdown(polishedReport, context);
      const csvExport = this.renderCsv(polishedReport);

      // 6) Basic quality metrics
      const qualityMetrics = this.estimateQuality(polishedReport);
      const readabilityScore = this.estimateReadability(polishedReport);
      const actionsPerformed = ['Polished text fields', 'Generated UI HTML', 'Generated Markdown', 'Generated CSV'];

      const result: AgentResult = {
        agentType: this.agentType,
        confidence: Math.min(0.98, 0.8 + readabilityScore * 0.15 + qualityMetrics.professionalismScore * 0.05),
        analysis: JSON.stringify(polishedReport), // final JSON
        metadata: {
          polishingActions: actionsPerformed,
          qualityMetrics,
          readabilityScore,
          stakeholderRelevance: {
            executiveLevel: 'High',
            technicalLevel: 'High',
            userLevel: 'High'
          },
          contentStructure: this.assessStructure(polishedReport),
          uiContent,
          markdownExport,
          csvExport,
          inputData: {
            originalLength: JSON.stringify(rawObj).length,
            polishedLength: JSON.stringify(polishedReport).length,
            improvementRatio: JSON.stringify(polishedReport).length / Math.max(1, JSON.stringify(rawObj).length)
          },
          recommendations: this.recommendations(polishedReport)
        },
        timestamp: new Date()
      };

      this.reportProgress(progressCallback, 'completed', result);
      return result;

    } catch (error) {
      this.reportProgress(progressCallback, 'error', undefined, error as Error);
      throw error;
    }
  }

  // -------------------- Prompt & Parsing --------------------


  private buildPolishPrompt(items: PolishingItem[], ctx: { domain?: string; stakeholders: string[] }): string {
    const stats = (ctx as any).stats || {};
    const domain = String(stats.domain ?? ctx.domain ?? 'Power BI Data Model');
    const tables = Number.isFinite(stats.tables) ? stats.tables : ((ctx as any).tables?.length ?? 0);
    const measures = Number.isFinite(stats.measures) ? stats.measures : ((ctx as any).measures?.length ?? 0);
    const relationships = Number.isFinite(stats.relationships) ? stats.relationships : ((ctx as any).relationships?.length ?? 0);

    const raw = typeof (ctx as any).rawReport === 'string'
      ? (ctx as any).rawReport
      : JSON.stringify((ctx as any).rawReport ?? {}, null, 2);

    const payload = JSON.stringify({
      domain,
      stakeholders: ctx.stakeholders,
      items
    });

    return `
SYSTEM:
You are a copy editor. Improve clarity, grammar, and concision ONLY.
Only edit what is present in the supplied content. Do NOT add new facts, numbers, table/column names, business processes, industry terms, or dataset specifics.
If content is unclear or missing, leave it as-is rather than guessing or inventing details.
Keep meaning identical. Avoid hype. UK English. No emojis. Keep within max words if provided.

FIXED_EXEC_VALUES (USE THESE EXACT VALUES — DO NOT INVENT OR OMIT):
- DOMAIN: ${domain}
- TABLES_COUNT: ${tables}
- MEASURES_COUNT: ${measures}
- RELATIONSHIPS_COUNT: ${relationships}

DATA SOURCE FOR RENDERING:
- Use rawReport.measures for "Key Measures". If empty, render an explicit notice: "No measures found".
- Use rawReport.tables[*].columns for per-table column counts.

USER INPUT (trusted JSON):
${payload}

ORIGINAL REPORT (JSON):
${raw.slice(0, 2000)}...

TASK:
Return ONLY JSON:
{"items":[{"id":"<same id>","text":"<polished text>"} ...]}

RULES:
- Preserve technical tokens (DAX, table/column names) exactly as-is.
- Do not invent stakeholders or metrics.
- Use finalReport.measures[*].purpose/whenToUse/successIndicators. If missing, use the provided heuristic fields (already included). DO NOT INVENT values.
- If a field is already crisp, return it unchanged.
- Use the FIXED_EXEC_VALUES above for any domain/count references.
`.trim();
  }

  private safeParsePolishedPayload(text: string): PolishedPayload | null {
    // direct
    try {
      const v = JSON.parse(text);
      if (v && typeof v === 'object' && Array.isArray(v.items)) return v as PolishedPayload;
    } catch {}
    // fences
    const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/,'');
    try {
      const v = JSON.parse(stripped);
      if (v && typeof v === 'object' && Array.isArray(v.items)) return v as PolishedPayload;
    } catch {}
    // fallback: try last {...}
    const m = stripped.match(/\{[\s\S]*\}$/);
    if (m) {
      try {
        const v = JSON.parse(m[0]);
        if (v && typeof v === 'object' && Array.isArray(v.items)) return v as PolishedPayload;
      } catch {}
    }
    return null;
  }

  // -------------------- Data shaping --------------------

  private ensureObject(input: unknown): any {
    if (!input) return {};
    if (typeof input === 'object') return input;
    try { return JSON.parse(String(input)); } catch { return {}; }
  }

  private normaliseShape(obj: any, context?: AgentContext) {
    const stats = (context as any)?.stats || {};
    return {
      overview: {
        domain: stats.domain ?? obj?.overview?.domain ?? 'Business Intelligence',
        tables: Number(stats.tables ?? obj?.overview?.tables ?? 0),
        measures: Number(stats.measures ?? obj?.overview?.measures ?? 0),
        relationships: Number(stats.relationships ?? obj?.overview?.relationships ?? 0),
        stakeholders: Array.isArray(obj?.overview?.stakeholders) ? obj.overview.stakeholders : (context?.stakeholders || []),
        notes: Array.isArray(obj?.overview?.notes) ? obj.overview.notes : [],
        usageGuidance: obj?.overview?.usageGuidance || {}
      },
      measures: Array.isArray(obj?.measures) ? obj.measures.map((m: any) => ({
        name: m.name ?? '',
        purpose: m.purpose ?? '',
        formula: m.formula ?? '',
        complexity: (m.complexity === 'simple' || m.complexity === 'medium' || m.complexity === 'complex') ? m.complexity : 'medium',
        risks: Array.isArray(m.risks) ? m.risks : [],
        fixes: Array.isArray(m.fixes) ? m.fixes.map((f: any) => ({
          title: f.title ?? '',
          rationale: f.rationale ?? '',
          fixedDax: f.fixedDax ?? ''
        })) : [],
        // Preserve enhanced fixes and complexity assessment
        enhancedFixes: m.enhancedFixes || [],
        complexityAssessment: m.complexityAssessment || {},
        whenToUse: m.whenToUse ?? '',
        successIndicators: m.successIndicators ?? '',
        folder: m.folder ?? '',
        description: m.description ?? '',
        formatString: m.formatString ?? ''
      })) : [],
      tables: Array.isArray(obj?.tables) ? obj.tables.map((t: any) => ({
        name: t.name ?? '',
        category: t.category ?? 'Regular',
        columns: Number(t.columns ?? 0),
        summary: t.summary ?? ''
      })) : [],
      relationships: Array.isArray(obj?.relationships) ? obj.relationships.map((r: any) => ({
        from: r.from ?? '',
        to: r.to ?? '',
        cardinality: r.cardinality ?? 'Many-to-One',
        direction: r.direction ?? 'Single'
      })) : [],
      lintFindings: Array.isArray(obj?.lintFindings) ? obj.lintFindings : [],
      
      // Preserve all the new contextual sections
      businessUserGuidance: obj?.businessUserGuidance || [],
      executiveInsights: obj?.executiveInsights || [],
      improvementRoadmap: obj?.improvementRoadmap || [],
      dataLineage: obj?.dataLineage || {},
      stakeholderContext: obj?.stakeholderContext || {}
    };
  }

  private collectPolishingItems(report: any): PolishingItem[] {
    const out: PolishingItem[] = [];

    // overview.notes
    (report.overview.notes || []).forEach((n: string, i: number) => {
      out.push({ id: `overview.notes[${i}]`, text: String(n), maxWords: 25 });
    });

    // measures.purpose + risks titles (short)
    report.measures.forEach((m: any, i: number) => {
      if (m.purpose) out.push({ id: `measures[${i}].purpose`, text: String(m.purpose), maxWords: 40 });
      (m.risks || []).forEach((r: string, j: number) =>
        out.push({ id: `measures[${i}].risks[${j}]`, text: String(r), maxWords: 18 }));
      (m.fixes || []).forEach((f: any, j: number) => {
        if (f.title) out.push({ id: `measures[${i}].fixes[${j}].title`, text: String(f.title), maxWords: 12 });
        if (f.rationale) out.push({ id: `measures[${i}].fixes[${j}].rationale`, text: String(f.rationale), maxWords: 30 });
      });
    });

    // tables.summary
    report.tables.forEach((t: any, i: number) => {
      if (t.summary) out.push({ id: `tables[${i}].summary`, text: String(t.summary), maxWords: 30 });
    });

    // lintFindings (short)
    report.lintFindings.forEach((l: string, i: number) => {
      out.push({ id: `lintFindings[${i}]`, text: String(l), maxWords: 18 });
    });

    return out;
  }

  private applyPolish(report: any, payload: PolishedPayload): any {
    if (!payload?.items?.length) return report;
    const byId = new Map(payload.items.map(x => [x.id, x.text]));
    const clone = JSON.parse(JSON.stringify(report));

    // overview.notes
    clone.overview.notes = (clone.overview.notes || []).map((n: string, i: number) =>
      byId.get(`overview.notes[${i}]`) ?? n);

    // measures
    clone.measures = (clone.measures || []).map((m: any, i: number) => {
      const p = byId.get(`measures[${i}].purpose`);
      if (p) m.purpose = p;
      m.risks = (m.risks || []).map((r: string, j: number) => byId.get(`measures[${i}].risks[${j}]`) ?? r);
      m.fixes = (m.fixes || []).map((f: any, j: number) => ({
        ...f,
        title: byId.get(`measures[${i}].fixes[${j}].title`) ?? f.title,
        rationale: byId.get(`measures[${i}].fixes[${j}].rationale`) ?? f.rationale
      }));
      return m;
    });

    // tables.summary
    clone.tables = (clone.tables || []).map((t: any, i: number) => ({
      ...t, summary: byId.get(`tables[${i}].summary`) ?? t.summary
    }));

    // lintFindings
    clone.lintFindings = (clone.lintFindings || []).map((l: string, i: number) =>
      byId.get(`lintFindings[${i}]`) ?? l);

    return clone;
  }

  // -------------------- Rendering (deterministic, no LLM) --------------------

  private renderHtml(r: any): string {
    const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]!));

    const kpi = (label: string, value: string) => `
      <div style="background:#0f172a; color:#fff; padding:1rem; border-radius:8px;">
        <div style="opacity:.9; font-size:.85rem;">${esc(label)}</div>
        <div style="font-weight:700; font-size:1.4rem; margin-top:.35rem;">${esc(value)}</div>
      </div>`.trim();

    const measureRow = (m: any, index: number) => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:12px; font-weight:600; text-align:center; width:4%;">${index + 1}</td>
        <td style="padding:12px; font-weight:600; width:20%;">
          ${esc(m.name)}
          ${m.complexity ? `<br><small style="color:#6b7280; font-weight:normal;">Complexity: ${esc(m.complexity)}</small>` : ''}
        </td>
        <td style="padding:12px; color:#374151; width:25%;">${esc(m.purpose || m.description || 'No description')}</td>
        <td style="padding:12px; font-size:.8rem; color:#6b7280; width:15%;">${m.whenToUse || 'General use'}</td>
        <td style="padding:12px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.85rem; width:30%;">
          <div style="background:#f8fafc; padding:.5rem; border-radius:4px; overflow:auto; max-height:100px;">
            ${esc(m.formula || m.dax || 'No formula')}
          </div>
        </td>
        <td style="padding:12px; text-align:center; width:6%;">
          ${m.risks?.length ? `<span style="color:#ef4444;">⚠️</span>` : `<span style="color:#10b981;">✓</span>`}
        </td>
      </tr>`.trim();

    const tableCard = (t: any) => `
      <div style="border:1px solid #e5e7eb; border-radius:8px; padding:1rem;">
        <div style="font-weight:600;">${esc(t.name)}</div>
        <div style="font-size:.9rem; color:#374151; margin:.25rem 0;">${esc(t.summary || '')}</div>
        <div style="font-size:.8rem; color:#6b7280;">Category: ${esc(t.category)} • Columns: ${esc(String(t.columns))}</div>
      </div>`.trim();

    const relRow = (rln: any) => {
      const isInactive = rln.active === false || rln.isActive === false;
      const inactiveTag = isInactive ? `<span style="margin-left:8px; padding:2px 6px; font-size:12px; border-radius:4px; background:#fee2e2; color:#991b1b;">Inactive</span>` : '';
      return `
        <div style="display:flex; justify-content:space-between; padding:.5rem .75rem; border:1px solid #e5e7eb; border-radius:6px;">
          <div>${esc(rln.from)} → ${esc(rln.to)}</div>
          <div style="font-size:.85rem; color:#6b7280;">${esc(rln.cardinality)} • ${esc(rln.direction)}${inactiveTag}</div>
        </div>`.trim();
    };

    return `
<div style="font-family:Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height:1.6; color:#111827; max-width:1200px; margin:0 auto; padding:16px;">
  <header style="margin-bottom:24px;">
    <h1 style="font-size:1.6rem; margin:0;">Power BI Model — Executive Overview</h1>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-top:12px;">
      ${kpi('Domain', r.overview.domain)}
      ${kpi('Tables', String(r.overview.tables))}
      ${kpi('Measures', String(r.overview.measures))}
      ${kpi('Relationships', String(r.overview.relationships))}
    </div>
    ${r.overview.notes?.length ? `<ul style="margin-top:12px; padding-left:20px; color:#374151;">${r.overview.notes.map((n:string)=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}
  </header>

  <section style="margin-bottom:20px;">
    <h2 style="font-size:1.25rem; margin:0 0 8px 0;">DAX Measures (${r.measures?.length || 0} total)</h2>
    <div style="overflow-x:auto; border:1px solid #e5e7eb; border-radius:8px;">
      <table style="width:100%; border-collapse:collapse; background:white;">
        <thead style="background:#f8fafc;">
          <tr>
            <th style="padding:14px 12px; text-align:center; font-weight:700; font-size:.85rem; color:#374151; border-bottom:2px solid #e5e7eb;">#</th>
            <th style="padding:14px 12px; text-align:left; font-weight:700; font-size:.85rem; color:#374151; border-bottom:2px solid #e5e7eb;">Measure Name</th>
            <th style="padding:14px 12px; text-align:left; font-weight:700; font-size:.85rem; color:#374151; border-bottom:2px solid #e5e7eb;">Business Purpose</th>
            <th style="padding:14px 12px; text-align:left; font-weight:700; font-size:.85rem; color:#374151; border-bottom:2px solid #e5e7eb;">Usage Context</th>
            <th style="padding:14px 12px; text-align:left; font-weight:700; font-size:.85rem; color:#374151; border-bottom:2px solid #e5e7eb;">DAX Formula</th>
            <th style="padding:14px 12px; text-align:center; font-weight:700; font-size:.85rem; color:#374151; border-bottom:2px solid #e5e7eb;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${r.measures.map(measureRow).join('')}
        </tbody>
      </table>
    </div>
  </section>

  <section style="margin-bottom:20px;">
    <h2 style="font-size:1.25rem; margin:0 0 8px 0;">Tables</h2>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px;">
      ${r.tables.map(tableCard).join('')}
    </div>
  </section>

  <section style="margin-bottom:20px;">
    <h2 style="font-size:1.25rem; margin:0 0 8px 0;">Relationships</h2>
    <div style="display:grid; gap:8px;">
      ${r.relationships.map(relRow).join('')}
    </div>
  </section>

  ${r.lintFindings?.length ? `
  <section style="margin-bottom:20px;">
    <h2 style="font-size:1.25rem; margin:0 0 8px 0;">Lint Findings</h2>
    <ul style="padding-left:20px; color:#374151;">
      ${r.lintFindings.map((x:string)=>`<li>${esc(x)}</li>`).join('')}
    </ul>
  </section>`:''}

  ${r.executiveInsights?.length ? `
  <section style="margin-bottom:20px;">
    <h2 style="font-size:1.25rem; margin:0 0 8px 0;">Executive Summary</h2>
    ${r.executiveInsights.map((insight:any)=>`
      <div style="border:1px solid #e5e7eb; border-radius:8px; padding:1rem; margin-bottom:12px;">
        <div style="font-weight:600; margin-bottom:.5rem;">${esc(insight.category)} 
          <span style="background:#10b981; color:white; padding:2px 8px; border-radius:12px; font-size:.75rem; margin-left:8px;">
            ${Math.round((insight.score || 0) * 100)}%
          </span>
        </div>
        ${Object.entries(insight.details || {}).map(([key, value]:any)=>`
          <div style="font-size:.9rem; margin-bottom:.25rem;">
            <strong>${esc(key.replace(/([A-Z])/g, ' $1').replace(/^./, (str: string) => str.toUpperCase()))}:</strong> ${esc(String(value))}
          </div>`).join('')}
      </div>`).join('')}
  </section>`:''}

  ${r.improvementRoadmap?.length ? `
  <section style="margin-bottom:20px;">
    <h2 style="font-size:1.25rem; margin:0 0 8px 0;">Improvement Recommendations</h2>
    ${r.improvementRoadmap.map((rec:any)=>`
      <div style="border:1px solid #e5e7eb; border-radius:8px; padding:1rem; margin-bottom:12px;">
        <div style="font-weight:600; margin-bottom:.5rem;">${esc(rec.category)}
          <span style="background:${rec.priority==='High'?'#ef4444':rec.priority==='Medium'?'#f59e0b':'#6b7280'}; color:white; padding:2px 8px; border-radius:12px; font-size:.75rem; margin-left:8px;">
            ${esc(rec.priority)} Priority
          </span>
        </div>
        <ul style="margin:.5rem 0 0 1rem;">
          ${rec.items.map((item:string)=>`<li>${esc(item)}</li>`).join('')}
        </ul>
      </div>`).join('')}
  </section>`:''}

  ${r.dataLineage?.keyEntities ? `
  <section style="margin-bottom:20px;">
    <h2 style="font-size:1.25rem; margin:0 0 8px 0;">Data Architecture</h2>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px;">
      ${r.dataLineage.keyEntities.factTables?.length ? `
        <div style="border:1px solid #e5e7eb; border-radius:8px; padding:1rem;">
          <div style="font-weight:600; margin-bottom:.5rem;">Fact Tables</div>
          <ul style="margin:0; padding-left:20px;">
            ${r.dataLineage.keyEntities.factTables.map((table:string)=>`<li>${esc(table)}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${r.dataLineage.keyEntities.dimensionTables?.length ? `
        <div style="border:1px solid #e5e7eb; border-radius:8px; padding:1rem;">
          <div style="font-weight:600; margin-bottom:.5rem;">Dimension Tables</div>
          <ul style="margin:0; padding-left:20px;">
            ${r.dataLineage.keyEntities.dimensionTables.map((table:string)=>`<li>${esc(table)}</li>`).join('')}
          </ul>
        </div>` : ''}
    </div>
  </section>`:''}

  ${r.businessUserGuidance?.length ? `
  <section style="margin-bottom:20px;">
    <h2 style="font-size:1.25rem; margin:0 0 8px 0;">Business User Guidance</h2>
    ${r.businessUserGuidance.map((guidance:any)=>`
      <div style="border:1px solid #e5e7eb; border-radius:8px; padding:1rem; margin-bottom:12px;">
        <div style="font-weight:600; margin-bottom:.5rem;">${esc(guidance.category)}</div>
        ${guidance.items.map((item:any)=>`
          <div style="margin-bottom:.75rem; padding:.5rem; background:#f8fafc; border-radius:6px;">
            ${item.measure ? `<div style="font-weight:500;">${esc(item.measure)}</div>` : ''}
            ${item.role ? `<div style="font-weight:500;">${esc(item.role)}</div>` : ''}
            <div style="font-size:.9rem; color:#374151;">${esc(item.guidance || item.focus)}</div>
            ${item.indicators?.length ? `<div style="font-size:.8rem; color:#6b7280; margin-top:.25rem;">Success indicators: ${item.indicators.join(', ')}</div>` : ''}
          </div>`).join('')}
      </div>`).join('')}
  </section>`:''}
</div>`.trim();
  }

  private renderMarkdown(r: any, context?: AgentContext): string {
    const lines: string[] = [];
    lines.push(`# Power BI Model — Executive Overview`);
    lines.push('');
    lines.push(`- **Domain:** ${r.overview.domain}`);
    lines.push(`- **Tables:** ${r.overview.tables}`);
    lines.push(`- **Measures:** ${r.overview.measures}`);
    lines.push(`- **Relationships:** ${r.overview.relationships}`);
    if (r.overview.notes?.length) {
      lines.push('');
      lines.push(`## Notes`);
      r.overview.notes.forEach((n: string) => lines.push(`- ${n}`));
    }
    lines.push('');
    lines.push(`## Key Measures`);
    r.measures.forEach((m: any) => {
      lines.push(`### ${m.name}`);
      if (m.purpose) lines.push(`**Purpose:** ${m.purpose}`);
      if (m.whenToUse) lines.push(`**When to use:** ${m.whenToUse}`);
      lines.push('');
      lines.push('```DAX');
      lines.push(m.formula || '');
      lines.push('```');
      lines.push(`**Complexity:** ${m.complexity}`);
      if (m.risks?.length) lines.push(`**Risks:** ${m.risks.join('; ')}`);
      if (m.fixes?.length) {
        lines.push(`**Suggested Fixes:**`);
        m.fixes.forEach((f: any) => {
          lines.push(`- ${f.title}${f.rationale ? ` — ${f.rationale}` : ''}`);
          lines.push('  ```DAX');
          lines.push(`  ${f.fixedDax || ''}`);
          lines.push('  ```');
        });
      }
      lines.push('');
    });

    lines.push(`## Tables`);
    r.tables.forEach((t: any) => {
      lines.push(`- **${t.name}** (${t.category}, ${t.columns} cols)${t.summary ? ` — ${t.summary}` : ''}`);
    });

    lines.push('');
    lines.push(`## Relationships`);
    r.relationships.forEach((rel: any) => {
      const isInactive = rel.active === false || rel.isActive === false;
      const status = isInactive ? ' **[INACTIVE]**' : '';
      lines.push(`- ${rel.from} → ${rel.to} (${rel.cardinality}, ${rel.direction})${status}`);
    });

    if (r.lintFindings?.length) {
      lines.push('');
      lines.push(`## Lint Findings`);
      r.lintFindings.forEach((f: string) => lines.push(`- ${f}`));
    }

    // Add new contextual sections
    if (r.executiveInsights?.length) {
      lines.push('');
      lines.push(`## Executive Summary`);
      r.executiveInsights.forEach((insight: any) => {
        lines.push(`### ${insight.category} (${Math.round((insight.score || 0) * 100)}%)`);
        Object.entries(insight.details || {}).forEach(([key, value]: any) => {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (str: string) => str.toUpperCase());
          lines.push(`- **${label}:** ${String(value)}`);
        });
        lines.push('');
      });
    }

    if (r.improvementRoadmap?.length) {
      lines.push('');
      lines.push(`## Improvement Recommendations`);
      r.improvementRoadmap.forEach((rec: any) => {
        lines.push(`### ${rec.category} (${rec.priority} Priority)`);
        rec.items.forEach((item: string) => lines.push(`- ${item}`));
        lines.push('');
      });
    }

    if (r.dataLineage?.keyEntities) {
      lines.push('');
      lines.push(`## Data Architecture`);
      if (r.dataLineage.keyEntities.factTables?.length) {
        lines.push(`### Fact Tables`);
        r.dataLineage.keyEntities.factTables.forEach((table: string) => lines.push(`- ${table}`));
      }
      if (r.dataLineage.keyEntities.dimensionTables?.length) {
        lines.push(`### Dimension Tables`);
        r.dataLineage.keyEntities.dimensionTables.forEach((table: string) => lines.push(`- ${table}`));
      }
      lines.push('');
    }

    if (r.businessUserGuidance?.length) {
      lines.push('');
      lines.push(`## Business User Guidance`);
      r.businessUserGuidance.forEach((guidance: any) => {
        lines.push(`### ${guidance.category}`);
        guidance.items.forEach((item: any) => {
          if (item.measure) lines.push(`**${item.measure}**`);
          if (item.role) lines.push(`**${item.role}**`);
          lines.push(`- ${item.guidance || item.focus}`);
          if (item.indicators?.length) {
            lines.push(`  - Success indicators: ${item.indicators.join(', ')}`);
          }
        });
        lines.push('');
      });
    }

    // Use context.stats for accurate counts
    const stats = (context as any)?.stats || {};
    const totalMeasures = stats.measures || (context as any)?.measures?.length || r.measures?.length || 0;
    const analyzedMeasures = r.measures?.length || 0;

    lines.push('');
    lines.push(`---`);
    lines.push(`### Generation Info`);
    lines.push(`- **Generated**: ${new Date().toISOString()}`);
    lines.push(`- **Analysis Scope**: ${analyzedMeasures} of ${totalMeasures} measures analyzed with AI`);
    lines.push(`- **Model Components**: ${r.overview.tables || 0} tables, ${r.overview.measures || 0} measures, ${r.overview.relationships || 0} relationships`);
    lines.push(`- **Tool**: DAX Catalog MVP with Claude AI`);
    lines.push('');
    lines.push(`_Generated by DAX Catalog AI Pipeline_`);
    return lines.join('\n');
  }

  private renderCsv(r: any): string {
    const esc = (s: string) => `"${String(s ?? '').replace(/"/g,'""')}"`;
    const rows: string[] = [];
    rows.push('Category,Name,Detail1,Detail2,Detail3');
    rows.push(`Overview,Domain,${esc(r.overview.domain)},,`);
    rows.push(`Overview,Counts,Tables:${r.overview.tables},Measures:${r.overview.measures},Relationships:${r.overview.relationships}`);

    r.measures.forEach((m: any) => {
      rows.push(`Measure,${esc(m.name)},${esc(m.purpose)},Complexity:${m.complexity},Risks:${esc((m.risks||[]).join(' | '))}`);
    });
    r.tables.forEach((t: any) => {
      rows.push(`Table,${esc(t.name)},${esc(t.category)},Columns:${t.columns},${esc(t.summary || '')}`);
    });
    r.relationships.forEach((rel: any) => {
      rows.push(`Relationship,${esc(rel.from)}→${esc(rel.to)},${esc(rel.cardinality)},${esc(rel.direction)},`);
    });
    if (r.lintFindings?.length) {
      r.lintFindings.forEach((f: string) => rows.push(`LintFinding,,${esc(f)},,`));
    }
    
    // Add new contextual sections to CSV
    if (r.executiveInsights?.length) {
      r.executiveInsights.forEach((insight: any) => {
        rows.push(`ExecutiveInsight,${esc(insight.category)},Score:${Math.round((insight.score || 0) * 100)}%,,`);
        Object.entries(insight.details || {}).forEach(([key, value]: any) => {
          rows.push(`ExecutiveDetail,${esc(key)},${esc(String(value))},,`);
        });
      });
    }
    
    if (r.improvementRoadmap?.length) {
      r.improvementRoadmap.forEach((rec: any) => {
        rows.push(`Improvement,${esc(rec.category)},Priority:${esc(rec.priority)},,`);
        rec.items.forEach((item: string) => rows.push(`ImprovementItem,,${esc(item)},,`));
      });
    }
    
    if (r.dataLineage?.keyEntities) {
      if (r.dataLineage.keyEntities.factTables?.length) {
        r.dataLineage.keyEntities.factTables.forEach((table: string) => 
          rows.push(`Architecture,FactTable,${esc(table)},,`)
        );
      }
      if (r.dataLineage.keyEntities.dimensionTables?.length) {
        r.dataLineage.keyEntities.dimensionTables.forEach((table: string) => 
          rows.push(`Architecture,DimensionTable,${esc(table)},,`)
        );
      }
    }
    
    if (r.businessUserGuidance?.length) {
      r.businessUserGuidance.forEach((guidance: any) => {
        rows.push(`BusinessGuidance,${esc(guidance.category)},,`);
        guidance.items.forEach((item: any) => {
          const measure = item.measure || '';
          const role = item.role || '';
          const focus = item.guidance || item.focus || '';
          rows.push(`GuidanceItem,${esc(measure + role)},${esc(focus)},,`);
        });
      });
    }
    
    return rows.join('\n');
  }

  // -------------------- Heuristics / Metrics --------------------

  private estimateQuality(r: any) {
    const professionalism = 0.9; // static heuristic; you can compute more precisely if needed
    const coverage =
      (Array.isArray(r.measures) ? Math.min(1, r.measures.length / Math.max(1, r.overview.measures || r.measures.length)) : 1) * 0.5 +
      (Array.isArray(r.tables) ? Math.min(1, r.tables.length / Math.max(1, r.overview.tables || r.tables.length)) : 1) * 0.3 +
      (Array.isArray(r.relationships) ? Math.min(1, r.relationships.length / Math.max(1, r.overview.relationships || r.relationships.length)) : 1) * 0.2;
    return {
      professionalismScore: professionalism,
      coverageScore: Number(coverage.toFixed(2))
    };
  }

  private estimateReadability(r: any): number {
    // crude readability proxy: shorter purposes & notes = higher score
    const purposes = r.measures.map((m: any) => (m.purpose || '')).join(' ');
    const notes = (r.overview.notes || []).join(' ');
    const len = (purposes.length + notes.length) || 1;
    const score = Math.max(0.7, Math.min(0.95, 1 - (len / 20000))); // clamp
    return Number(score.toFixed(2));
  }

  private assessStructure(r: any) {
    return {
      hasOverview: !!r.overview,
      hasMeasures: Array.isArray(r.measures),
      hasTables: Array.isArray(r.tables),
      hasRelationships: Array.isArray(r.relationships),
      hasLintFindings: Array.isArray(r.lintFindings),
    };
  }

  private recommendations(r: any): string[] {
    const recs: string[] = [];
    if ((r.lintFindings || []).length) recs.push('Address lint findings in measures to improve reliability.');
    if ((r.measures || []).some((m: any) => (m.fixes || []).length)) recs.push('Review suggested DAX fixes and validate against business rules.');
    if ((r.overview.notes || []).length === 0) recs.push('Add 2–3 business notes to overview for stakeholder context.');
    return recs.length ? recs : ['Review with stakeholders and publish to your documentation portal.'];
  }
}
