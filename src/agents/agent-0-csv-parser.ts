// agents/agent-0-csv-parser.ts
import { AgentResult, AgentContext } from './base-agent';
import { InfoViewParser } from '../csv-parser';
import { enrichMeasureSchema, enrichTableSchema, enrichRelationshipSchema } from '../lib/format-defaults';
import * as path from 'path';

type Cardinality = 'Many-to-One' | 'One-to-Many' | 'One-to-One' | 'Many-to-Many';
type Direction = 'Single' | 'Both';

export class CSVParserAgent {
  private parser: InfoViewParser;
  private agentType: string;

  constructor() {
    this.agentType = 'CSV Parser & Data Ingestion';
    this.parser = new InfoViewParser();
  }

  /**
   * Parse CSV files from directory and return structured data context
   */
  async parseDirectory(directory: string, measureCount: string | number = 'all'): Promise<AgentResult> {
    const abs = path.resolve(directory);
    console.log(`🔍 Agent 0: CSV Parser - Processing directory: ${abs}`);

    try {
      // 1) Parse raw CSVs with the InfoViewParser
      const parsed = await this.parser.parseDirectory(abs);

      // 2) Normalise + validate shapes
      const normalized = this.normaliseParsed(parsed);

      // 3) Limit measures if requested
      const limitedMeasures = this.applyMeasureLimit(normalized.measures, measureCount);

      // 4) Build AgentContext
      const agentContext: AgentContext = {
        measures: limitedMeasures.map(m => enrichMeasureSchema({
          name: m.name,
          expression: m.expression,
          displayFolder: m.displayFolder,
          description: m.description,
          tableName: m.table,
          formatString: m.formatString
        })),
        tables: normalized.tables.map((t: any) => enrichTableSchema({
          name: t.name,
          rowCount: t.rowCount,
          description: t.description,
          isHidden: t.isHidden
        })),
        columns: normalized.columns.map((c: any) => ({
          tableName: c.tableName,
          name: c.name,
          dataType: c.dataType,
          isKey: c.isKey,
          isHidden: c.isHidden,
          description: c.description,
          formatString: c.formatString
        })),
        relationships: normalized.relationships.map((r: any) => enrichRelationshipSchema({
          fromTable: r.fromTable,
          fromColumn: r.fromColumn,
          toTable: r.toTable,
          toColumn: r.toColumn,
          cardinality: r.cardinality as Cardinality
        }))
      };

      // 5) Build ID maps + integrity checks
      const ids = this.buildIdMaps(agentContext);
      const integrity = this.assessIntegrity(agentContext, ids);

      // 6) Metrics & quality
      const quality = this.assessDataQuality(agentContext, parsed?.metadata);
      const processingStats = {
        measuresCount: normalized.measures.length,
        tablesCount: normalized.tables.length,
        columnsCount: normalized.columns.length,
        relationshipsCount: normalized.relationships.length,
      };

      // 7) Human-readable summary (for CLI)
      const analysis = this.generateDataSummary(parsed?.metadata, agentContext, integrity);

      // 8) Return standardized result
      return this.createResult(
        analysis,
        {
          parsedData: agentContext,
          directory: abs,
          ids,
          integrity,
          fileDiscovery: parsed?.metadata || { found: [], missing: [] },
          dataQuality: quality,
          processingStats,
          categories: Array.from(new Set(agentContext.measures?.map(m => (m as any).displayFolder).filter(Boolean)))
        },
        0.99 // deterministic
      );

    } catch (error: any) {
      console.error('❌ Agent 0: CSV parsing failed:', error);
      throw new Error(`CSV parsing failed: ${error?.message || String(error)}`);
    }
  }

  // -------------------------- Normalisation --------------------------

  private normaliseParsed(raw: any) {
    const measures = (raw?.measures || []).map((m: any) => ({
      name: String(m?.name ?? m?.MeasureName ?? '').trim(),
      expression: String(m?.expression ?? m?.Expression ?? '').trim(),
      displayFolder: String(m?.displayFolder ?? m?.DisplayFolder ?? '').trim(),
      description: String(m?.description ?? m?.Description ?? '').trim(),
      table: String(m?.table ?? m?.Table ?? '').trim(),
      formatString: String(m?.formatString ?? m?.FormatString ?? '').trim()
    })).filter((m: any) => m.name);

    // De-dup measures by name (first wins)
    const seen = new Set<string>();
    const dedupMeasures = measures.filter((m: any) => {
      const k = m.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const tables = (raw?.tables || []).map((t: any) => ({
      name: String(t?.name ?? t?.TableName ?? '').trim(),
      rowCount: this.toNumber(t?.rowCount ?? t?.RowCount ?? 0),
      description: String(t?.description ?? t?.Description ?? '').trim(),
      isHidden: Boolean(t?.isHidden ?? t?.IsHidden ?? false)
    })).filter((t: any) => t.name);

    const columns = (raw?.columns || []).map((c: any) => {
      const name = String(c?.name ?? c?.ColumnName ?? '').trim();
      const tbl = String(c?.tableName ?? c?.TableName ?? '').trim();
      const isKey =
        Boolean(c?.isKey ?? c?.IsKey) ||
        /\b(id|key)\b/i.test(name) ||
        /[_\s](id|key)$/i.test(name);
      return {
        tableName: tbl,
        name,
        dataType: String(c?.dataType ?? c?.DataType ?? 'String').trim(),
        isKey,
        isHidden: Boolean(c?.isHidden ?? c?.IsHidden ?? false),
        description: String(c?.description ?? c?.Description ?? '').trim(),
        formatString: String(c?.formatString ?? c?.FormatString ?? '').trim()
      };
    }).filter((c: any) => c.tableName && c.name);

    const relationships = (raw?.relationships || []).map((r: any) => ({
      fromTable: String(r?.fromTable ?? r?.FromTable ?? r?.tableFrom ?? r?.TableFrom ?? r?.Table1 ?? '').trim(),
      fromColumn: String(r?.fromColumn ?? r?.FromColumn ?? r?.ColumnFrom ?? r?.Column1 ?? '').trim(),
      toTable: String(r?.toTable ?? r?.ToTable ?? r?.tableTo ?? r?.TableTo ?? r?.Table2 ?? '').trim(),
      toColumn: String(r?.toColumn ?? r?.ToColumn ?? r?.ColumnTo ?? r?.Column2 ?? '').trim(),
      cardinality: this.normaliseCardinality(r?.cardinality ?? r?.Cardinality),
      direction: this.normaliseDirection(r?.crossFilterDirection ?? r?.CrossFilterDirection),
      active: typeof r?.active === 'boolean' ? r.active : (typeof r?.IsActive === 'boolean' ? r.IsActive : true)
    })).filter((r: any) => r.fromTable && r.fromColumn && r.toTable && r.toColumn);

    return { measures: dedupMeasures, tables, columns, relationships, metadata: raw?.metadata || {} };
  }

  private normaliseCardinality(v: any): Cardinality {
    const s = String(v || '').toLowerCase();
    if (s.includes('one-to-one')) return 'One-to-One';
    if (s.includes('one-to-many')) return 'One-to-Many';
    if (s.includes('many-to-one')) return 'Many-to-One';
    if (s.includes('many-to-many') || s === 'm2m') return 'Many-to-Many';
    return 'Many-to-One';
  }

  private normaliseDirection(v: any): Direction {
    const s = String(v || '').toLowerCase();
    if (s === 'both' || s === 'bi' || s.includes('both')) return 'Both';
    return 'Single';
  }

  private toNumber(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private applyMeasureLimit(measures: any[], measureCount: string | number) {
    if (measureCount === 'all') return measures;
    const limit = parseInt(String(measureCount), 10);
    if (!Number.isFinite(limit) || limit <= 0) return measures;
    console.log(`📊 Limiting analysis to first ${limit} measures (out of ${measures.length} total)`);
    return measures.slice(0, limit);
  }

  // -------------------------- Integrity & Quality --------------------------

  private buildIdMaps(ctx: AgentContext) {
    const tableIdMap: Record<string, string> = {};
    (ctx.tables || []).forEach(t => {
      const key = (t.name || '').toLowerCase();
      if (key) tableIdMap[key] = t.name!;
    });

    const columnIdMap: Record<string, string> = {};
    (ctx.columns || []).forEach(c => {
      const key = `${(c.tableName || '').toLowerCase()}|${(c.name || '').toLowerCase()}`;
      if (c.tableName && c.name) columnIdMap[key] = `${c.tableName}[${c.name}]`;
    });

    return { tableIdMap, columnIdMap };
  }

  private assessIntegrity(ctx: AgentContext, ids: { tableIdMap: Record<string,string>, columnIdMap: Record<string,string> }) {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Relationship checks
    let relUnknownTables = 0;
    let relUnknownColumns = 0;
    let relManyToMany = 0;
    let relInactive = 0;

    (ctx.relationships || []).forEach((r: any) => {
      const fromTblOk = Boolean(ids.tableIdMap[(r.fromTable || '').toLowerCase()]);
      const toTblOk   = Boolean(ids.tableIdMap[(r.toTable || '').toLowerCase()]);
      if (!fromTblOk || !toTblOk) {
        relUnknownTables++;
        issues.push(`Unknown table in relationship: ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]`);
      }
      const fromColOk = Boolean(ids.columnIdMap[`${(r.fromTable || '').toLowerCase()}|${(r.fromColumn || '').toLowerCase()}`]);
      const toColOk   = Boolean(ids.columnIdMap[`${(r.toTable || '').toLowerCase()}|${(r.toColumn || '').toLowerCase()}`]);
      if (!fromColOk || !toColOk) {
        relUnknownColumns++;
        issues.push(`Unknown column in relationship: ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]`);
      }
      if ((r.cardinality || '') === 'Many-to-Many') {
        relManyToMany++;
        warnings.push(`Many-to-Many: ${r.fromTable}[${r.fromColumn}] ↔ ${r.toTable}[${r.toColumn}]`);
      }
      if (r.active === false) {
        relInactive++;
        warnings.push(`Inactive relationship: ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]`);
      }
    });

    // Column duplication check
    const dupCols = this.findDuplicateColumns(ctx.columns || []);

    return {
      summary: {
        relUnknownTables,
        relUnknownColumns,
        relManyToMany,
        relInactive,
        duplicateColumns: dupCols.length
      },
      issues,
      warnings,
      duplicateColumns: dupCols
    };
  }

  private findDuplicateColumns(cols: any[]) {
    const seen = new Map<string, number>();
    const dups: string[] = [];
    cols.forEach(c => {
      const k = `${(c.tableName || '').toLowerCase()}|${(c.name || '').toLowerCase()}`;
      const count = (seen.get(k) || 0) + 1;
      seen.set(k, count);
      if (count === 2) dups.push(`${c.tableName}[${c.name}]`);
    });
    return dups;
  }

  private assessDataQuality(ctx: AgentContext, fileMeta?: any): Record<string, any> {
    const measures = ctx.measures || [];
    const tables = ctx.tables || [];
    const columns = ctx.columns || [];
    const relationships = ctx.relationships || [];

    const completeness = {
      measures: measures.length ? measures.filter(m => m.name && m.expression).length / measures.length : 1,
      measureDescriptions: measures.length ? measures.filter(m => (m as any).description).length / measures.length : 0,
      tables: tables.length ? tables.filter(t => t.name).length / tables.length : 1,
      columns: columns.length ? columns.filter(c => c.tableName && c.name).length / columns.length : 1,
      relationships: relationships.length ? relationships.filter(r => r.fromTable && r.toTable && r.fromColumn && r.toColumn).length / relationships.length : 1
    };

    const complexity = {
      advancedDAX: measures.filter((m: any) => /\b(CALCULATE|SUMX|AVERAGEX|FILTER|VAR|RETURN|RANKX|TREATAS)\b/i.test(m.expression || '')).length,
      timeIntelligence: measures.filter((m: any) => /\b(DATESINPERIOD|TOTALYTD|SAMEPERIODLASTYEAR|DATEADD|DATESMTD|DATESQTD)\b/i.test(m.expression || '')).length
    };

    const governance = {
      displayFolders: Array.from(new Set(measures.map((m:any) => (m.displayFolder || '').trim()).filter(Boolean))).length,
      hiddenTables: tables.filter((t:any) => t.isHidden).length,
      hiddenColumns: columns.filter((c:any) => c.isHidden).length
    };

    return {
      files: {
        found: fileMeta?.found || [],
        missing: fileMeta?.missing || []
      },
      completeness,
      complexity,
      governance
    };
  }

  // -------------------------- Summary & Result --------------------------

  private generateDataSummary(meta: any, context: AgentContext, integrity: any): string {
    const found = (meta?.found || []).join(', ') || 'None';
    const missing = (meta?.missing || []).join(', ') || 'None';

    const m = context.measures?.length || 0;
    const t = context.tables?.length || 0;
    const c = context.columns?.length || 0;
    const r = context.relationships?.length || 0;

    const complexCount = (context.measures || []).filter((x:any) =>
      /\b(CALCULATE|SUMX|AVERAGEX|FILTER|VAR|RETURN|RANKX|TREATAS)\b/i.test(x.expression || '')
    ).length;

    const factGuess = (context.tables || []).filter((x:any) => (x.rowCount || 0) > 10000).length;
    const dimGuess  = Math.max(0, t - factGuess);

    return [
      '📊 DATA INGESTION COMPLETE',
      '',
      `Files Processed: ${found}`,
      `Missing Files: ${missing}`,
      '',
      'Data Summary:',
      `- Measures: ${m} (complex: ${complexCount})`,
      `- Tables: ${t}  • approx ${factGuess} fact / ${dimGuess} dimension`,
      `- Columns: ${c}`,
      `- Relationships: ${r}`,
      '',
      'Integrity:',
      `- Unknown tables in relationships: ${integrity.summary.relUnknownTables}`,
      `- Unknown columns in relationships: ${integrity.summary.relUnknownColumns}`,
      `- Many-to-Many relationships: ${integrity.summary.relManyToMany}`,
      `- Inactive relationships: ${integrity.summary.relInactive}`,
      `- Duplicate columns: ${integrity.summary.duplicateColumns}`,
      '',
      'Ready for Domain Classification (Agent 1)'
    ].join('\n');
  }

  private createResult(
    analysis: string,
    metadata: Record<string, any> = {},
    confidence: number = 0.99
  ): AgentResult {
    return {
      agentType: this.agentType,
      confidence,
      analysis,
      metadata,
      timestamp: new Date()
    };
  }

  // Extract parsed context for orchestrator
  extractParsedContext(result: AgentResult): AgentContext {
    return result.metadata?.parsedData || {};
  }
}
