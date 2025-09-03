export function inferFormatString(name: string, expression?: string): string {
  const n = (name || '').toLowerCase();
  const e = (expression || '').toLowerCase();
  
  // Percent format detection
  if (n.includes('%') || n.includes('percent') || n.includes('rate') || 
      /divide\([^,]+,\s*[^)]+\)\s*\*\s*100/i.test(e) ||
      e.includes('* 100') || e.includes('*100')) {
    return "0.0%";
  }
  
  // Average format detection
  if (/\b(avg|average|mean)\b/i.test(n) || /\baverage(x)?\s*\(/i.test(e)) {
    return "0.0";
  }
  
  // Count format detection
  if (/\b(count|number|qty|quantity)\b/i.test(n) || /\bcount(a|ax|rows|x)?\s*\(/i.test(e)) {
    return "#,##0";
  }
  
  // Keep existing format string or use basic number format
  return "#,##0";
}

export function enrichMeasureSchema(measure: any): any {
  const name = measure.name || measure.MeasureName || '';
  const expression = measure.expression || measure.Expression || '';
  const existingFormat = measure.formatString || measure.FormatString || '';
  
  return {
    ...measure,
    name,
    expression,
    formatString: existingFormat || inferFormatString(name, expression),
    description: measure.description || measure.Description || '',
    displayFolder: measure.displayFolder || measure.DisplayFolder || '',
    tableName: measure.tableName || measure.table || measure.Table || ''
  };
}

export function enrichTableSchema(table: any): any {
  const name = table.name || table.TableName || '';
  
  return {
    ...table,
    name,
    description: table.description || table.Description || '',
    rowCount: Number(table.rowCount || table.RowCount || 0) || 0,
    isHidden: Boolean(table.isHidden || table.IsHidden),
    // Infer role based on size heuristic (not domain-specific)
    role: (Number(table.rowCount || table.RowCount || 0) > 10000) ? 'fact' : 'dimension'
  };
}

export function enrichRelationshipSchema(relationship: any): any {
  return {
    ...relationship,
    fromTable: relationship.fromTable || relationship.FromTable || relationship.tableFrom || relationship.TableFrom || relationship.Table1 || '',
    fromColumn: relationship.fromColumn || relationship.FromColumn || relationship.columnFrom || relationship.ColumnFrom || relationship.Column1 || '',
    toTable: relationship.toTable || relationship.ToTable || relationship.tableTo || relationship.TableTo || relationship.Table2 || '',
    toColumn: relationship.toColumn || relationship.ToColumn || relationship.columnTo || relationship.ColumnTo || relationship.Column2 || '',
    cardinality: relationship.cardinality || relationship.Cardinality || 'Many-to-One',
    direction: relationship.direction || relationship.crossFilterDirection || relationship.CrossFilterDirection || 'Single',
    active: relationship.active !== false && relationship.IsActive !== false
  };
}