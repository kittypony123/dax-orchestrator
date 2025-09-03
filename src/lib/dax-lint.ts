export type LintSeverity = 'info' | 'warn' | 'error';

export interface LintFinding {
  ruleId: string;
  message: string;
  severity: LintSeverity;
  example?: string;
}

const rx = {
  divideOperator: /\b([A-Z_][A-Z0-9_]*|[a-z_][a-z0-9_]*|\[[^\]]+\]|[A-Za-z0-9_]+\[[^\]]+\])\s*\/\s*([A-Z_][A-Z0-9_]*|[a-z_][a-z0-9_]*|\[[^\]]+\]|[A-Za-z0-9_]+\[[^\]]+\])/,
  hasDIVIDE: /\bDIVIDE\s*\(/i,
  averageXOverMeasure: /\bAVERAGEX\s*\([^,]+,\s*\[[^\]]+\]\s*\)/i,
  countAxTrue: /\bCOUNTAX\s*\([^,]+,\s*TRUE\s*\)/i,
  timeIntelFuncs: /\b(DATESINPERIOD|SAMEPERIODLASTYEAR|DATEADD|PARALLELPERIOD)\b/i,
  maxAnchor: /\bMAX\s*\([^)]+\)/i,
  relatedInMeasure: /\bRELATED\s*\(/i,
  ifWithoutGuard: /\bIF\s*\(/i,
  guards: /\b(ISBLANK|ISNUMBER|VALUE|SELECTEDVALUE|HASONEVALUE)\b/i,
};

export function lintDax(expression?: string): LintFinding[] {
  const e = (expression || '').trim();
  if (!e) return [];

  const out: LintFinding[] = [];

  // 1) Use of "/" instead of DIVIDE()
  if (rx.divideOperator.test(e) && !rx.hasDIVIDE.test(e)) {
    out.push({
      ruleId: 'calc.divide-operator',
      severity: 'warn',
      message: 'Division operator detected without DIVIDE(); verify divide-by-zero behavior.',
      example: 'DIVIDE([Numerator], [Denominator])'
    });
  }

  // 2) AVERAGEX over a measure (row context vs measure context confusion)
  if (rx.averageXOverMeasure.test(e)) {
    out.push({
      ruleId: 'iter.avgx-measure',
      severity: 'info',
      message: 'AVERAGEX over a measure may average computed values; confirm the intent vs averaging a base column.',
    });
  }

  // 3) COUNTAX(TRUE()) – counts all rows; COUNTROWS is clearer
  if (rx.countAxTrue.test(e)) {
    out.push({
      ruleId: 'iter.countax-true',
      severity: 'info',
      message: 'COUNTAX with TRUE() counts all rows; COUNTROWS() is typically clearer and faster.',
      example: 'COUNTROWS( Table )'
    });
  }

  // 4) Time intelligence with MAX() anchor (be explicit about endpoint)
  if (rx.timeIntelFuncs.test(e) && rx.maxAnchor.test(e)) {
    out.push({
      ruleId: 'time.max-anchor',
      severity: 'info',
      message: 'Time intelligence anchored on MAX() can drift with filters; verify intended end-of-period anchor.',
    });
  }

  // 5) RELATED() inside measures – check relationship direction
  if (rx.relatedInMeasure.test(e)) {
    out.push({
      ruleId: 'model.related-in-measure',
      severity: 'info',
      message: 'RELATED() in measures can be fragile; verify relationship direction and filter context.',
    });
  }

  // 6) IF() without common guards
  if (rx.ifWithoutGuard.test(e) && !rx.guards.test(e)) {
    out.push({
      ruleId: 'logic.if-no-guards',
      severity: 'info',
      message: 'IF() without guards (HASONEVALUE/ISBLANK/etc.) may mis-handle blanks or multi-selects.',
    });
  }

  return out;
}