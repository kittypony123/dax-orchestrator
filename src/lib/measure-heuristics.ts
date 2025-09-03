// src/lib/measure-heuristics.ts
export interface HeuristicMeasureInput {
  name: string;
  expression?: string;
  displayFolder?: string;
  description?: string;
}

export interface HeuristicMeasureOutput {
  name: string;
  kind: 'count' | 'sum' | 'avg' | 'ratio' | 'percent' | 'time-intel' | 'windowed' | 'other';
  window?: string;               // e.g. "Last 12 Months", "30 Days"
  purpose: string;               // plain-English
  whenToUse: string;             // scenarios
  successIndicators: string[];   // generic guidance
  risks: string[];               // generic lint flags (no replacements)
  dependencies: string[];        // referenced tables/columns/measures (best-effort)
}

/** Title-case from typical measure names: Total_Trips, tripsPerBike -> "Trips Per Bike" */
export function normalizeTitle(name: string): string {
  const s = name.replace(/[_\-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Quick scan of the DAX to classify measure kind */
export function inferKind(m: HeuristicMeasureInput): HeuristicMeasureOutput['kind'] {
  const n = (m.name || '').toLowerCase();
  const e = (m.expression || '').toUpperCase();

  if (/%|PCT|PERCENT/.test(n) || /\bDIVIDE\s*\(/.test(e) && /\b100\b/.test(e)) return 'percent';
  if (/\bDIVIDE\s*\(/.test(e)) return 'ratio';
  if (/\bAVERAGE|AVERAGEX\b/.test(e) || /\bAVG\b/.test(n)) return 'avg';
  if (/\bCOUNT|COUNTX|DISTINCTCOUNT\b/.test(e) || /\bcount\b/.test(n)) return 'count';
  if (/\bSUM|SUMX\b/.test(e) || /\btotal|sum\b/.test(n)) return 'sum';
  if (/\bDATESINPERIOD|SAMEPERIODLASTYEAR|DATEADD|PARALLELPERIOD\b/.test(e)) return 'time-intel';
  return 'other';
}

/** Extract a human window like "Last 12 Months" / "Last 30 Days" / "YoY" */
export function extractWindow(expr?: string): string | undefined {
  const e = (expr || '').toUpperCase();
  const m1 = e.match(/DATESINPERIOD\([^,]+,\s*[^,]+,\s*-\s*(\d+)\s*,\s*(DAY|MONTH|YEAR|WEEK)\)/);
  if (m1) return `Last ${m1[1]} ${m1[2]}${Number(m1[1]) > 1 ? 's' : ''}`;
  if (/SAMEPERIODLASTYEAR/.test(e) || /DATEADD\([^,]+,\s*-1\s*,\s*YEAR\)/.test(e)) return 'Year over Year';
  if (/DATEADD\([^,]+,\s*-1\s*,\s*MONTH\)/.test(e)) return 'Month over Month';
  if (/DATEADD\([^,]+,\s*-1\s*,\s*WEEK\)/.test(e)) return 'Week over Week';
  return undefined;
}

/** Extract simple dependencies: Table[Column] and [Measure] references */
export function extractDependencies(expr?: string): string[] {
  const e = expr || '';
  const cols = Array.from(e.matchAll(/([A-Za-z0-9_]+)\[([^\]]+)\]/g)).map(m => `${m[1]}[${m[2]}]`);
  const meas = Array.from(e.matchAll(/\[(?!\s*Measures?\s*\])([^\]]+)\]/g)).map(m => `[${m[1]}]`);
  return Array.from(new Set([...cols, ...meas]));
}

/** Generic risks that apply to any model (no replacements suggested) */
export function detectRisks(expr?: string): string[] {
  const e = (expr || '').toUpperCase();
  const risks: string[] = [];

  if (/\b\/\b/.test(e) && !/\bDIVIDE\s*\(/.test(e))
    risks.push('Division operator used without DIVIDE(); may cause divide-by-zero errors.');

  if (/\bAVERAGEX\s*\([^)]+,\s*\[[^\]]+\]\s*\)/.test(e))
    risks.push('AVERAGEX over a measure may yield unintended results; ensure row-level expression.');

  if (/\bCOUNTAX\s*\([^)]+,\s*TRUE\s*\)/.test(e))
    risks.push('COUNTAX with TRUE() counts all rows; COUNTROWS() may be clearer and faster.');

  if (/\bMAX\([^)]+\)\s*,\s*-?\d+\s*,\s*(DAY|MONTH|YEAR|WEEK)\)/.test(e) && /DATEADD|DATESINPERIOD/.test(e))
    risks.push('Time-intel anchored on MAX() can drift; confirm intended end-of-period anchor.');

  if (/\bRELATED\(/.test(e))
    risks.push('RELATED() inside measures can be fragile; verify relationship direction and context.');

  if (/\bIF\s*\(/.test(e) && !/\bISBLANK|ISNUMBER|VALUE|SELECTEDVALUE|HASONEVALUE/.test(e))
    risks.push('IF() without guard conditions could mis-handle blanks or multi-selects.');

  return risks;
}

/** Generic business blurbs synthesized from name + kind + window */
export function generatePurpose(name: string, kind: HeuristicMeasureOutput['kind'], window?: string): string {
  const t = normalizeTitle(name);
  const w = window ? ` (${window})` : '';
  switch (kind) {
    case 'sum':      return `${t}${w} totals the underlying numeric values for performance tracking.`;
    case 'count':    return `${t}${w} counts records to show activity or volume.`;
    case 'avg':      return `${t}${w} highlights typical performance by averaging underlying values.`;
    case 'percent':  return `${t}${w} expresses performance as a percentage for easy comparison.`;
    case 'ratio':    return `${t}${w} compares two quantities to reveal efficiency or conversion.`;
    case 'time-intel': return `${t}${w} applies time-intelligence to compare or roll up periods.`;
    case 'windowed': return `${t}${w} evaluates performance over a rolling window.`;
    default:         return `${t}${w} summarizes a key business signal from the model.`;
  }
}

export function generateWhenToUse(kind: HeuristicMeasureOutput['kind'], window?: string): string {
  const w = window ? ` over ${window.toLowerCase()}` : '';
  switch (kind) {
    case 'sum':      return `Use for totals${w}, target progress, and period close reviews.`;
    case 'count':    return `Use to track activity volume${w}, funnel counts, and data completeness.`;
    case 'avg':      return `Use to monitor average performance${w} and detect outliers.`;
    case 'percent':  return `Use for goal attainment${w}, conversion, and benchmark comparisons.`;
    case 'ratio':    return `Use to compare effectiveness${w} across segments or time.`;
    case 'time-intel': return `Use for YoY/MoM trends, seasonality, and rolling period analysis.`;
    case 'windowed': return `Use for short-term trend monitoring and recent momentum checks.`;
    default:         return `Use when a concise business signal is needed across time or segments.`;
  }
}

export function generateSuccessIndicators(kind: HeuristicMeasureOutput['kind']): string[] {
  switch (kind) {
    case 'percent': return ['Consistently above target threshold', 'Stable or improving trend'];
    case 'ratio':   return ['Improving efficiency over time', 'Better than peer segments'];
    case 'avg':     return ['Stable variance', 'Within expected control limits'];
    case 'count':   return ['Increasing activity when desired', 'No unexplained drops'];
    case 'sum':     return ['On plan vs goal', 'Healthy growth trajectory'];
    default:        return ['Stable trend', 'Aligned with business expectations'];
  }
}

/** Main entry: produce generic, model-agnostic measure docs */
export function heuristicDescribe(m: HeuristicMeasureInput): HeuristicMeasureOutput {
  const kind = inferKind(m);
  const window = extractWindow(m.expression);
  const purpose = generatePurpose(m.name, kind, window);
  const whenToUse = generateWhenToUse(kind, window);
  const successIndicators = generateSuccessIndicators(kind);
  const risks = detectRisks(m.expression);
  const dependencies = extractDependencies(m.expression);
  return { name: m.name, kind, window, purpose, whenToUse, successIndicators, risks, dependencies };
}