import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import { DAXMeasure, DAXTable, DAXColumn, DAXRelationship } from './types';
import { FileManager } from './file-manager';
import { getLogger } from './logger';

export class InfoViewParser {
  private fileManager: FileManager;
  private logger = getLogger('InfoViewParser');
  private tableIdMap: Map<string, string> = new Map();
  private columnIdMap: Map<string, string> = new Map();

  constructor() {
    this.fileManager = new FileManager();
  }

  /**
   * Parse all available CSV files from a directory with intelligent file discovery
   */
  async parseDirectory(directory: string): Promise<{
    measures: DAXMeasure[];
    tables: DAXTable[];
    columns: DAXColumn[];
    relationships: DAXRelationship[];
    metadata: { found: string[]; missing: string[]; };
  }> {
    const discovery = await this.fileManager.discoverFiles(directory);
    
    console.log(`🔍 File Discovery Results:`);
    console.log(`   Directory: ${discovery.directory}`);
    console.log(`   Found: ${Object.keys(discovery.found).join(', ')}`);
    if (discovery.missing.length > 0) {
      console.log(`   Missing: ${discovery.missing.join(', ')}`);
    }

    // First, build ID mappings from tables and columns
    if (discovery.found.tables) {
      await this.buildTableIdMap(discovery.found.tables);
    }
    if (discovery.found.columns) {
      await this.buildColumnIdMap(discovery.found.columns);
    }

    const [measures, tables, columns, relationships] = await Promise.allSettled([
      discovery.found.measures ? this.parseMeasures(discovery.found.measures) : Promise.resolve([]),
      discovery.found.tables ? this.parseTables(discovery.found.tables) : Promise.resolve([]),
      discovery.found.columns ? this.parseColumns(discovery.found.columns) : Promise.resolve([]),
      discovery.found.relationships ? this.parseRelationships(discovery.found.relationships) : Promise.resolve([])
    ]);

    return {
      measures: measures.status === 'fulfilled' ? measures.value : [],
      tables: tables.status === 'fulfilled' ? tables.value : [],
      columns: columns.status === 'fulfilled' ? columns.value : [],
      relationships: relationships.status === 'fulfilled' ? relationships.value : [],
      metadata: {
        found: Object.keys(discovery.found),
        missing: discovery.missing
      }
    };
  }

  
  /**
   * Parse INFO.VIEW.MEASURES() CSV export
   */
  async parseMeasures(csvPath: string): Promise<DAXMeasure[]> {
    if (!(await this.fileManager.validateFile(csvPath))) {
      this.logger.warn(`Cannot read measures file: ${csvPath}, returning empty array`);
      return [];
    }

    console.log(`📈 Parsing measures from: ${path.basename(csvPath)}`);
    
    return new Promise((resolve, reject) => {
      const measures: DAXMeasure[] = [];
      let rowCount = 0;
      let skippedCount = 0;
      
      fsSync.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row: any) => {
          rowCount++;
          try {
            const measure: DAXMeasure = {
              name: this.extractValue(row, ['Name', 'name', 'MeasureName', 'measureName', 'Measure', 'measure']),
              expression: this.cleanExpression(this.extractValue(row, ['Expression', 'expression', 'Formula', 'formula', 'DAX', 'dax', 'DAX/Expression', 'Definition', 'definition'])),
              description: this.extractValue(row, ['Description', 'description', 'Comment', 'comment', 'Notes', 'notes']),
              isValid: this.parseValidState(this.extractValue(row, ['State', 'state', 'IsValid', 'isValid', 'Status', 'status'])),
              table: this.extractTableReference(row),
              formatString: this.cleanFormatString(this.extractValue(row, ['FormatString', 'formatString', 'Format', 'format', 'DisplayFormat', 'displayFormat'])),
              displayFolder: this.extractValue(row, ['DisplayFolder', 'displayFolder', 'Folder', 'folder', 'Category', 'category'])
            };
            
            if (measure.name && measure.expression) {
              measures.push(measure);
            } else {
              skippedCount++;
              if (!measure.name) console.warn(`  ⚠️  Row ${rowCount}: Missing measure name - Available fields: ${Object.keys(row).join(', ')}`);
              if (!measure.expression) console.warn(`  ⚠️  Row ${rowCount}: Missing expression for measure "${measure.name}" - Available fields: ${Object.keys(row).join(', ')}`);
            }
          } catch (error) {
            skippedCount++;
            console.warn(`  ⚠️  Row ${rowCount}: Parse error -`, error);
          }
        })
        .on('end', () => {
          console.log(`✅ Parsed ${measures.length} measures (${skippedCount} skipped) from ${path.basename(csvPath)}`);
          resolve(measures);
        })
        .on('error', (error: Error) => {
          console.error(`❌ Failed to parse measures from ${path.basename(csvPath)}:`, error);
          reject(error);
        });
    });
  }

  /**
   * Parse INFO.VIEW.TABLES() CSV export
   */
  async parseTables(csvPath: string): Promise<DAXTable[]> {
    if (!(await this.fileManager.validateFile(csvPath))) {
      this.logger.warn(`Cannot read tables file: ${csvPath}, returning empty array`);
      return [];
    }

    console.log(`🗃️ Parsing tables from: ${path.basename(csvPath)}`);
    
    return new Promise((resolve, reject) => {
      const tables: DAXTable[] = [];
      let rowCount = 0;
      let skippedCount = 0;
      
      fsSync.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row: any) => {
          rowCount++;
          try {
            const table: DAXTable = {
              name: this.extractValue(row, ['Name', 'name', 'TableName', 'tableName', 'Table', 'table']),
              description: this.extractValue(row, ['Description', 'description', 'Comment', 'comment', 'Notes', 'notes']),
              dataCategory: this.extractValue(row, ['DataCategory', 'dataCategory', 'Category', 'category', 'Type', 'type', 'Kind', 'kind']),
              isHidden: this.parseBoolean(this.extractValue(row, ['IsHidden', 'isHidden', 'Hidden', 'hidden', 'Visible', 'visible']))
            };
            
            if (table.name) {
              // Default category if not specified
              if (!table.dataCategory) {
                table.dataCategory = table.name.toLowerCase().includes('dim') ? 'Dimension' : 'Regular';
              }
              tables.push(table);
            } else {
              skippedCount++;
              console.warn(`  ⚠️  Row ${rowCount}: Missing table name - Available fields: ${Object.keys(row).join(', ')} - Raw row:`, JSON.stringify(row, null, 2));
            }
          } catch (error) {
            skippedCount++;
            console.warn(`  ⚠️  Row ${rowCount}: Parse error -`, error);
          }
        })
        .on('end', () => {
          // Filter out INFO.VIEW metadata tables
          const businessTables = tables.filter(table => !this.isInfoViewTable(table));
          const infoViewCount = tables.length - businessTables.length;
          
          if (infoViewCount > 0) {
            console.log(`🧹 Filtered out ${infoViewCount} INFO.VIEW metadata tables`);
          }
          
          console.log(`✅ Parsed ${businessTables.length} business tables (${skippedCount} skipped) from ${path.basename(csvPath)}`);
          resolve(businessTables);
        })
        .on('error', (error: Error) => {
          console.error(`❌ Failed to parse tables from ${path.basename(csvPath)}:`, error);
          reject(error);
        });
    });
  }

  /**
   * Parse INFO.VIEW.COLUMNS() CSV export with flexible column mapping
   */
  async parseColumns(csvPath: string): Promise<DAXColumn[]> {
    if (!(await this.fileManager.validateFile(csvPath))) {
      this.logger.warn(`Cannot read columns file: ${csvPath}, returning empty array`);
      return [];
    }

    return new Promise((resolve, reject) => {
      const columns: DAXColumn[] = [];
      
      fsSync.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row: any) => {
          try {
            const column: DAXColumn = {
              name: this.extractColumnName(row),
              tableName: this.extractTableName(row),
              dataType: this.extractDataType(row),
              description: this.extractDescription(row),
              isHidden: this.parseBoolean(this.extractHidden(row)),
              formatString: this.extractFormatString(row)
            };
            
            if (column.name && column.tableName) {
              columns.push(column);
            } else {
              console.warn(`Skipping column - Name: "${column.name}", TableName: "${column.tableName}" - Available fields: ${Object.keys(row).join(', ')}`);
            }
          } catch (error) {
            console.warn(`Skipping invalid column row:`, error);
          }
        })
        .on('end', () => {
          // Filter out INFO.VIEW metadata columns (cross-reference with table names)
          const businessColumns = columns.filter(column => !this.isInfoViewColumn(column));
          const infoViewCount = columns.length - businessColumns.length;
          
          if (infoViewCount > 0) {
            console.log(`🧹 Filtered out ${infoViewCount} INFO.VIEW metadata columns`);
          }
          
          console.log(`✅ Parsed ${businessColumns.length} business columns from ${csvPath}`);
          resolve(businessColumns);
        })
        .on('error', reject);
    });
  }

  /**
   * Parse INFO.VIEW.RELATIONSHIPS() CSV export
   */
  async parseRelationships(csvPath: string): Promise<DAXRelationship[]> {
    if (!(await this.fileManager.validateFile(csvPath))) {
      this.logger.warn(`Cannot read relationships file: ${csvPath}, returning empty array`);
      return [];
    }

    return new Promise((resolve, reject) => {
      const relationships: DAXRelationship[] = [];
      
      fsSync.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row: any) => {
          try {
            // First try to parse from the Relationship string format
            const relationshipString = this.extractValue(row, ['Relationship', 'relationship', 'RelationshipString']);
            let relationship: DAXRelationship | null = null;
            
            if (relationshipString) {
              relationship = this.parseRelationshipString(relationshipString);
              
              // Add additional metadata if available
              if (relationship) {
                relationship.isActive = this.parseBoolean(this.extractValue(row, ['IsActive', 'isActive', 'Active', 'active']));
                relationship.crossFilterDirection = this.extractValue(row, ['CrossFilteringBehavior', 'crossFilteringBehavior', 'CrossFilterDirection', 'crossFilterDirection']);
              }
            }
            
            // Fallback to individual field parsing if string parsing failed
            if (!relationship) {
              relationship = {
                fromTable: this.extractValue(row, ['FromTable', 'fromTable']) || 
                          this.getTableNameFromId(this.extractValue(row, ['FromTableID', 'fromTableID'])),
                fromColumn: this.extractValue(row, ['FromColumn', 'fromColumn']) || 
                           this.getColumnNameFromId(this.extractValue(row, ['FromColumnID', 'fromColumnID'])),
                toTable: this.extractValue(row, ['ToTable', 'toTable']) || 
                        this.getTableNameFromId(this.extractValue(row, ['ToTableID', 'toTableID'])),
                toColumn: this.extractValue(row, ['ToColumn', 'toColumn']) || 
                         this.getColumnNameFromId(this.extractValue(row, ['ToColumnID', 'toColumnID'])),
                cardinality: this.buildCardinalityFromParts(
                  this.extractValue(row, ['FromCardinality', 'fromCardinality']),
                  this.extractValue(row, ['ToCardinality', 'toCardinality'])
                ) || this.getCardinalityFromBehavior(this.extractValue(row, ['CrossFilteringBehavior', 'crossFilteringBehavior'])),
                crossFilterDirection: this.getCrossFilterDirection(this.extractValue(row, ['CrossFilteringBehavior', 'crossFilteringBehavior'])),
                isActive: this.parseBoolean(this.extractValue(row, ['IsActive', 'isActive', 'Active', 'active']))
              };
            }
            
            if (relationship && relationship.fromTable && relationship.toTable && relationship.fromColumn && relationship.toColumn) {
              relationships.push(relationship);
            } else {
              console.warn(`Skipping relationship - FromTable: "${relationship?.fromTable}", ToTable: "${relationship?.toTable}", FromColumn: "${relationship?.fromColumn}", ToColumn: "${relationship?.toColumn}" - Available fields: ${Object.keys(row).join(', ')}`);
            }
          } catch (error) {
            console.warn(`Skipping invalid relationship row:`, error);
          }
        })
        .on('end', () => {
          console.log(`✅ Parsed ${relationships.length} relationships from ${csvPath}`);
          resolve(relationships);
        })
        .on('error', reject);
    });
  }

  /**
   * Create sample data for testing when no CSV files are available
   */
  createSampleData(): { measures: DAXMeasure[], tables: DAXTable[], columns: DAXColumn[] } {
    const measures: DAXMeasure[] = [
      {
        name: 'Total Sales',
        expression: 'SUM(Sales[Amount])',
        description: '',
        isValid: true,
        table: 'Sales'
      },
      {
        name: 'Average Order Value', 
        expression: 'DIVIDE([Total Sales], [Order Count], 0)',
        description: '',
        isValid: true,
        table: 'Sales'
      },
      {
        name: 'Previous Year Sales',
        expression: 'CALCULATE([Total Sales], DATEADD(DimDate[Date], -1, YEAR))',
        description: '',
        isValid: true,
        table: 'Sales'
      },
      {
        name: 'Sales Growth %',
        expression: 'DIVIDE([Total Sales] - [Previous Year Sales], [Previous Year Sales], 0)',
        description: '',
        isValid: true,
        table: 'Sales'
      }
    ];

    const tables: DAXTable[] = [
      {
        name: 'Sales',
        description: 'Sales transaction data',
        dataCategory: 'Fact',
        isHidden: false
      },
      {
        name: 'DimDate',
        description: 'Date dimension table',
        dataCategory: 'Time',
        isHidden: false
      },
      {
        name: 'Products',
        description: 'Product master data',
        dataCategory: 'Dimension',
        isHidden: false
      }
    ];

    const columns: DAXColumn[] = [
      {
        name: 'Amount',
        tableName: 'Sales',
        dataType: 'Decimal',
        description: 'Sale amount in USD',
        isHidden: false
      },
      {
        name: 'Quantity',
        tableName: 'Sales', 
        dataType: 'Integer',
        description: 'Number of items sold',
        isHidden: false
      },
      {
        name: 'Date',
        tableName: 'DimDate',
        dataType: 'DateTime',
        description: 'Transaction date',
        isHidden: false
      }
    ];

    return { measures, tables, columns };
  }

  /**
   * Save sample data to CSV files for testing
   */
  async createSampleCSVFiles(outputDir: string = './sample-data'): Promise<void> {
    try {
      await fs.access(outputDir);
    } catch {
      await fs.mkdir(outputDir, { recursive: true });
    }

    const { measures, tables, columns } = this.createSampleData();

    // Create measures CSV
    const measuresCSV = [
      'Name,Expression,Description,IsValid,Table',
      ...measures.map(m => `"${m.name}","${m.expression}","${m.description}",${m.isValid},"${m.table}"`)
    ].join('\n');

    await fs.writeFile(path.join(outputDir, 'measures.csv'), measuresCSV);
    
    // Create tables CSV
    const tablesCSV = [
      'Name,Description,DataCategory,IsHidden',
      ...tables.map(t => `"${t.name}","${t.description}","${t.dataCategory}",${t.isHidden}`)
    ].join('\n');

    await fs.writeFile(path.join(outputDir, 'tables.csv'), tablesCSV);

    console.log(`✅ Created sample CSV files in ${outputDir}/`);
  }

  private parseBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim();
      // Handle various boolean representations
      return lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on' || lower === 'enabled';
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    return false;
  }

  // Parse Power BI State field (Valid/Invalid/Error or numeric codes)
  private parseValidState(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim();
      return lower === 'valid' || lower === 'true' || lower === '1' || lower === 'active';
    }
    if (typeof value === 'number') {
      // Power BI numeric state codes: 0=Ready, 1=NotReady, 2=Incomplete, etc.
      // Typically 0, 1, or 2 means valid/ready
      return value >= 0 && value <= 2;
    }
    return true; // Default to valid if not specified
  }

  // Generic helper to extract value from multiple possible field names
  private extractValue(row: any, fieldNames: string[]): string {
    for (const field of fieldNames) {
      if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
        let value = typeof row[field] === 'string' ? row[field].trim() : String(row[field]);
        
        // Handle quoted strings in CSV (remove outer quotes but preserve inner ones)
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        
        return value;
      }
    }
    return '';
  }
  
  // Clean and normalize format strings
  private cleanFormatString(formatString: string): string {
    if (!formatString) return '';
    
    // Remove outer quotes if present
    let cleaned = formatString.trim();
    if (cleaned.length >= 2 && cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    }
    
    return cleaned;
  }
  
  // Clean and normalize DAX expressions
  private cleanExpression(expression: string): string {
    if (!expression) return '';
    
    // Remove outer quotes if present, but preserve DAX string literals
    let cleaned = expression.trim();
    
    // Only remove outer quotes if the entire expression is quoted
    // This prevents removing quotes from DAX string literals inside the expression
    if (cleaned.length >= 2 && cleaned.startsWith('"') && cleaned.endsWith('"')) {
      // Check if this is likely a quoted CSV field vs a DAX string literal
      const inner = cleaned.slice(1, -1);
      // If there are no unescaped internal quotes, it's likely a CSV field wrapper
      if (!inner.includes('""') && inner.split('"').length <= 2) {
        cleaned = inner;
      }
    }
    
    // Restore escaped quotes in DAX expressions
    cleaned = cleaned.replace(/""/g, '"');
    
    return cleaned;
  }

  // Helper methods to identify and filter INFO.VIEW metadata
  private isInfoViewTable(table: DAXTable): boolean {
    if (!table.name) return false;
    
    const tableName = table.name.toUpperCase();
    const description = (table.description || '').toUpperCase();
    const expression = (table as any).expression || '';
    
    // Check for specific metadata table patterns
    const metadataPatterns = [
      'MEASURES_TABLE',
      'COLUMN_TABLE', 
      'RELATIONSHIP_TABLE',
      'TABLES_TABLE',
      'INFO.VIEW',
      '_TABLE' // Catch other utility tables like Measures_Table, etc.
    ];
    
    // Check for INFO.VIEW expressions in table definition
    const infoViewPatterns = [
      'INFO.VIEW.MEASURES()',
      'INFO.VIEW.COLUMNS()', 
      'INFO.VIEW.RELATIONSHIPS()',
      'INFO.VIEW.TABLES()',
      'INFO.VIEW.MEASURES',
      'INFO.VIEW.COLUMNS',
      'INFO.VIEW.RELATIONSHIPS', 
      'INFO.VIEW.TABLES'
    ];
    
    // Check metadata patterns in table name
    const isMetadataTable = metadataPatterns.some(pattern => tableName.includes(pattern));
    
    // Check INFO.VIEW patterns in expression or description
    const hasInfoViewPattern = infoViewPatterns.some(pattern => 
      expression.toUpperCase().includes(pattern) ||
      tableName.includes('INFO.VIEW') ||
      description.includes('INFO.VIEW')
    );
    
    return isMetadataTable || hasInfoViewPattern;
  }

  private isInfoViewColumn(column: DAXColumn): boolean {
    if (!column.tableName || !column.name) return false;
    
    // Check if column belongs to an INFO.VIEW table
    const tableNameUpper = column.tableName.toUpperCase();
    const infoViewTablePatterns = [
      'INFO.VIEW',
      'MEASURES',
      'COLUMNS',
      'RELATIONSHIPS',
      'TABLES'
    ];
    
    // Check if table name suggests it's an INFO.VIEW table
    const isInfoViewTable = infoViewTablePatterns.some(pattern => 
      tableNameUpper.includes(pattern) && 
      (tableNameUpper.includes('INFO') || tableNameUpper === pattern)
    );
    
    // Also check column name patterns
    const columnNameUpper = column.name.toUpperCase();
    const infoViewColumnPatterns = [
      'MEASURENAME',
      'EXPRESSION', 
      'TABLENAME',
      'COLUMNNAME',
      'FROMTABLE',
      'TOTABLE',
      'DATATYPE',
      'CARDINALITY'
    ];
    
    const hasInfoViewColumnPattern = infoViewColumnPatterns.some(pattern =>
      columnNameUpper === pattern
    );
    
    return isInfoViewTable || (hasInfoViewColumnPattern && 
      (tableNameUpper.length < 15 || tableNameUpper.includes('INFO')));
  }

  // Build cardinality from separate From/To cardinality fields
  private buildCardinalityFromParts(fromCardinality: string, toCardinality: string): string {
    if (!fromCardinality || !toCardinality) {
      return 'Many-to-One'; // Default assumption
    }
    
    const from = fromCardinality.toLowerCase();
    const to = toCardinality.toLowerCase();
    
    if (from.includes('many') && to.includes('one')) return 'Many-to-One';
    if (from.includes('one') && to.includes('many')) return 'One-to-Many';
    if (from.includes('one') && to.includes('one')) return 'One-to-One';
    if (from.includes('many') && to.includes('many')) return 'Many-to-Many';
    
    return `${fromCardinality}-to-${toCardinality}`;
  }

  // Extract table reference - handle both table names and TableIDs
  private extractTableReference(row: any): string {
    // First try direct table name fields
    const directName = this.extractValue(row, ['Table', 'table', 'TableName', 'tableName', 'Parent', 'parent']);
    if (directName) return directName;
    
    // Then try TableID mapping
    const tableId = this.extractValue(row, ['TableID', 'tableId', 'Table_ID']);
    if (tableId) {
      const mappedName = this.getTableNameFromId(tableId);
      if (mappedName && !mappedName.startsWith('Table_')) {
        return mappedName;
      }
    }
    
    return '';
  }

  // Parse Power BI relationship string format: 'Table1'[Column1] *[<-]1 'Table2'[Column2]
  private parseRelationshipString(relationshipString: string): DAXRelationship | null {
    if (!relationshipString || typeof relationshipString !== 'string') {
      return null;
    }

    try {
      // Clean the string
      const cleaned = relationshipString.trim();
      
      // Pattern to match: 'Table1'[Column1] *[<-]1 'Table2'[Column2]
      // Also handles variations like: Table1[Column1] <-> Table2[Column2]
      const relationshipPattern = /(?:'?([^'\[\]]+)'?)\[([^\]]+)\]\s*([*\d]*)\[?([<>-]+)\]?([*\d]*)\s*(?:'?([^'\[\]]+)'?)\[([^\]]+)\]/;
      
      const match = cleaned.match(relationshipPattern);
      
      if (!match) {
        console.warn(`Could not parse relationship string: "${relationshipString}"`);
        return null;
      }

      const [, fromTable, fromColumn, leftCardinality, direction, rightCardinality, toTable, toColumn] = match;
      
      // Determine cardinality and direction based on symbols
      let cardinality = 'Many-to-One'; // Default
      let crossFilterDirection = 'Single'; // Default
      
      if (direction) {
        // Parse direction symbols: <-, ->, <->, <, >, etc.
        if (direction.includes('<-') || direction.includes('->')) {
          crossFilterDirection = direction.includes('<->') ? 'Both' : 'Single';
        }
        
        // Parse cardinality from surrounding symbols
        const leftCard = leftCardinality || (direction.startsWith('*') ? '*' : '1');
        const rightCard = rightCardinality || (direction.endsWith('*') ? '*' : '1');
        
        if (leftCard === '*' && rightCard === '1') {
          cardinality = 'Many-to-One';
        } else if (leftCard === '1' && rightCard === '*') {
          cardinality = 'One-to-Many';
        } else if (leftCard === '1' && rightCard === '1') {
          cardinality = 'One-to-One';
        } else if (leftCard === '*' && rightCard === '*') {
          cardinality = 'Many-to-Many';
        }
      }

      return {
        fromTable: fromTable.trim(),
        fromColumn: fromColumn.trim(),
        toTable: toTable.trim(),
        toColumn: toColumn.trim(),
        cardinality,
        crossFilterDirection
      };
      
    } catch (error) {
      console.warn(`Error parsing relationship string "${relationshipString}":`, error);
      return null;
    }
  }

  // Build dynamic table ID mapping from tables.csv
  private async buildTableIdMap(tablesPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fsSync.createReadStream(tablesPath)
        .pipe(csv())
        .on('data', (row: any) => {
          const id = this.extractValue(row, ['ID', 'id', 'TableID', 'tableId']);
          const name = this.extractValue(row, ['Name', 'name', 'TableName', 'tableName']);
          if (id && name) {
            this.tableIdMap.set(id.toString(), name);
          }
        })
        .on('end', () => {
          console.log(`🗺️ Built table ID map with ${this.tableIdMap.size} entries`);
          resolve();
        })
        .on('error', reject);
    });
  }

  // Build dynamic column ID mapping from columns.csv
  private async buildColumnIdMap(columnsPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fsSync.createReadStream(columnsPath)
        .pipe(csv())
        .on('data', (row: any) => {
          const id = this.extractValue(row, ['ID', 'id', 'ColumnID', 'columnId']);
          const name = this.extractValue(row, ['Name', 'name', 'ColumnName', 'columnName', 'ExplicitName', 'InferredName']);
          if (id && name) {
            this.columnIdMap.set(id.toString(), name);
          }
        })
        .on('end', () => {
          console.log(`🗺️ Built column ID map with ${this.columnIdMap.size} entries`);
          resolve();
        })
        .on('error', reject);
    });
  }

  private getTableNameFromId(tableId: string): string {
    if (!tableId) return '';
    return this.tableIdMap.get(tableId.toString()) || `Table_${tableId}`;
  }

  private getDataTypeName(dataType: string): string {
    // Map DataType codes to readable names
    const typeMap: Record<string, string> = {
      '1': 'String',
      '2': 'Integer', 
      '3': 'Double',
      '4': 'Decimal',
      '5': 'DateTime',
      '6': 'Boolean',
      '7': 'Binary'
    };
    return typeMap[dataType] || dataType || 'Unknown';
  }

  private getColumnNameFromId(columnId: string): string {
    if (!columnId) return '';
    return this.columnIdMap.get(columnId.toString()) || `Column_${columnId}`;
  }

  private getCardinalityFromBehavior(behavior: string): string {
    // Map CrossFilteringBehavior to cardinality
    // This is a simplified mapping - real Power BI has more complex rules
    switch (behavior) {
      case '1': return 'Many-to-One';
      case '2': return 'One-to-Many'; 
      case '3': return 'Many-to-Many';
      default: return 'One-to-Many';
    }
  }

  private getCrossFilterDirection(behavior: string): string {
    // Map CrossFilteringBehavior to filter direction
    switch (behavior) {
      case '1': return 'Single';
      case '2': return 'Both';
      case '3': return 'Both';
      default: return 'Single';
    }
  }

  // Flexible extraction methods to handle different CSV formats
  private extractColumnName(row: any): string {
    const nameFields = [
      'Name', 'name', 'ColumnName', 'columnName', 'ExplicitName', 'InferredName', 
      'Column', 'column'
    ];
    
    for (const field of nameFields) {
      if (row[field] && row[field].trim()) {
        return row[field].trim();
      }
    }
    return '';
  }

  private extractTableName(row: any): string {
    const tableFields = [
      'Table', 'table', 'TableName', 'tableName',
      'ParentTable', 'parentTable'
    ];
    
    // First try direct table name fields
    for (const field of tableFields) {
      if (row[field] && row[field].trim()) {
        return row[field].trim();
      }
    }
    
    // If no direct table name, try TableID mapping
    if (row.TableID) {
      const tableName = this.getTableNameFromId(row.TableID);
      if (tableName && !tableName.startsWith('Table_')) {
        return tableName;
      }
    }
    
    return '';
  }

  private extractDataType(row: any): string {
    const dataTypeFields = [
      'DataType', 'dataType', 'Type', 'type',
      'ColumnType', 'columnType', 'FieldType', 'fieldType'
    ];
    
    for (const field of dataTypeFields) {
      if (row[field] !== undefined && row[field] !== null) {
        // Handle numeric codes or string values
        if (typeof row[field] === 'string' && row[field].trim()) {
          // Try to map if it's a numeric string
          const mapped = this.getDataTypeName(row[field].trim());
          if (mapped !== 'Unknown') return mapped;
          // Otherwise return as-is
          return row[field].trim();
        } else if (typeof row[field] === 'number') {
          return this.getDataTypeName(row[field].toString());
        }
      }
    }
    return 'Unknown';
  }

  private extractDescription(row: any): string {
    const descFields = [
      'Description', 'description', 'Desc', 'desc',
      'Comment', 'comment', 'Notes', 'notes'
    ];
    
    for (const field of descFields) {
      if (row[field] && row[field].trim()) {
        return row[field].trim();
      }
    }
    return '';
  }

  private extractHidden(row: any): any {
    const hiddenFields = [
      'IsHidden', 'isHidden', 'Hidden', 'hidden',
      'IsVisible', 'isVisible', 'Visible', 'visible'
    ];
    
    for (const field of hiddenFields) {
      if (row[field] !== undefined && row[field] !== null) {
        // Handle IsVisible vs IsHidden (inverse logic)
        if (field.toLowerCase().includes('visible')) {
          return !this.parseBoolean(row[field]);
        }
        return row[field];
      }
    }
    return false;
  }

  private extractFormatString(row: any): string {
    const formatFields = [
      'FormatString', 'formatString', 'Format', 'format',
      'DisplayFormat', 'displayFormat', 'NumberFormat', 'numberFormat'
    ];
    
    for (const field of formatFields) {
      if (row[field] && row[field].trim()) {
        return row[field].trim();
      }
    }
    return '';
  }
}
