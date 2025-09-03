// Core data structures for DAX Catalog MVP

export interface DAXMeasure {
  name: string;
  expression: string;
  description?: string;
  isValid: boolean;
  table?: string;
  formatString?: string;
  displayFolder?: string;
}

export interface DAXTable {
  name: string;
  description?: string;
  dataCategory?: string;
  isHidden: boolean;
}

export interface DAXColumn {
  name: string;
  tableName: string;
  dataType: string;
  description?: string;
  isHidden: boolean;
  formatString?: string;
}

export interface DAXRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: string;
  crossFilterDirection?: string;
  isActive?: boolean;
}

export interface EnhancedDAXEntry {
  // Original metadata
  original: DAXMeasure | DAXTable | DAXColumn | DAXRelationship;
  
  // AI-generated enhancements
  businessDescription: string;
  technicalNotes: string;
  businessRules: string[];
  dependencies: string[];
  examples?: string[];
  
  // Metadata
  generatedAt: Date;
  confidence: number; // 0-1 score for AI analysis quality
}

export interface DocumentationTemplate {
  format: 'markdown' | 'html' | 'confluence';
  sections: {
    overview: boolean;
    measures: boolean;
    tables: boolean;
    relationships: boolean;
    businessGlossary: boolean;
  };
  businessFriendly: boolean;
}

export interface AnalysisResult {
  businessDescription: string;
  technicalDescription: string;
  complexity: 'simple' | 'medium' | 'complex';
  businessRules: string[];
  dependencies: string[];
  examples: string[];
  useCases: string[];
  limitations: string[];
  interpretation: string;
  relatedMetrics: string[];
  dataQuality: string;
  performanceNotes: string;
  // Enhanced Power BI expert analysis fields
  daxPatterns?: string[];
  industryBenchmarks?: string[];
  alertingCriteria?: string[];
  confidence: number;
}