// src/lib/measure-enricher.ts
import { heuristicDescribe } from './measure-heuristics';

export interface EnrichInputMeasure {
  name: string;
  expression?: string;
  displayFolder?: string;
  description?: string;
  formatString?: string;
}

export interface EnrichOutputMeasure {
  name: string;
  purpose: string;
  whenToUse: string;
  successIndicators: string[];
  risks: string[];
  dependencies: string[];
  dax: string;
  folder?: string;
  description?: string;
  formatString?: string;
}

export interface GlossaryQuickRef {
  name?: string;
  term?: string;
  definition?: string;
  whenToUse?: string;
  successIndicators?: string[] | string;
}

export interface GlossaryShape {
  metricQuickRef?: GlossaryQuickRef[];
}

function toPercentFormat(name: string, expr?: string): boolean {
  const n = name.toLowerCase();
  const e = (expr || '').toUpperCase();
  return /%|pct|percent|rate/.test(n) || (/\bDIVIDE\s*\(/.test(e) && /\b100\b/.test(e));
}

function defaultFormatString(name: string, expr?: string): string | undefined {
  if (toPercentFormat(name, expr)) return '0.0%';
  if (/avg|average/i.test(name)) return '0.0';
  return undefined; // stay safe; don't guess currency or thousands
}

export function enrichMeasures(
  measures: EnrichInputMeasure[],
  glossary?: GlossaryShape
): EnrichOutputMeasure[] {
  const mapGloss = new Map<string, GlossaryQuickRef>();
  (glossary?.metricQuickRef || []).forEach(g => {
    const key = String(g.name || g.term || '').toLowerCase();
    if (key) mapGloss.set(key, g);
  });

  return measures.map((m) => {
    const h = heuristicDescribe({
      name: m.name,
      expression: m.expression,
      displayFolder: m.displayFolder,
      description: m.description
    });

    const g = mapGloss.get(m.name.toLowerCase());

    const successFromGloss = Array.isArray(g?.successIndicators)
      ? g?.successIndicators as string[]
      : (typeof g?.successIndicators === 'string'
          ? (g?.successIndicators as string).split(',').map(s => s.trim()).filter(Boolean)
          : []);

    return {
      name: m.name,
      purpose: (g?.definition || h.purpose),
      whenToUse: (g?.whenToUse || h.whenToUse),
      successIndicators: successFromGloss.length ? successFromGloss : h.successIndicators,
      risks: h.risks,
      dependencies: h.dependencies,
      dax: m.expression || '',
      folder: m.displayFolder,
      description: m.description,
      formatString: m.formatString || defaultFormatString(m.name, m.expression)
    };
  });
}