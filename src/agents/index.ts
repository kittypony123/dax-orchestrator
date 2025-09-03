// DAX Catalog Agent System - Export all agents
export { BaseAgent, AgentResult, AgentContext } from './base-agent';
export { CSVParserAgent } from './agent-0-csv-parser';
export { DomainClassifierAgent } from './agent-1-domain-classifier';
export { BusinessGlossaryAgent } from './agent-2-business-glossary';
export { DataArchitectureAgent } from './agent-3-data-architecture';
export { DAXAnalyzerAgent } from './agent-4-dax-analyzer';
export { ReportSynthesisAgent, SynthesisInput } from './agent-5-report-synthesis';
export { ContentPolishAgent } from './agent-6-content-polish';

// Agent system metadata
export const AGENT_SYSTEM_INFO = {
  version: '3.0.0',
  architecture: 'Hybrid Architecture - Shared Claude Client + Progress Tracking',
  workflow: 'Agent 0 → Agent 1 → [Agent 2, 3, 4 parallel with shared client] → Agent 5 → Agent 6',
  agents: {
    0: 'CSV Parser - Data ingestion from Power BI INFO.VIEW exports',
    1: 'Domain Classifier - Business domain analysis',
    2: 'Business Glossary - Terminology and definitions',
    3: 'Data Architecture - Data model intelligence', 
    4: 'DAX Analyzer - Measure interpretation',
    5: 'Report Synthesis - Unified documentation',
    6: 'Content Polish - Review and publication formatting'
  },
  capabilities: [
    'Domain-agnostic analysis across any business context',
    'True parallel processing with shared Claude client',
    'Real-time progress tracking for UI integration', 
    'Individual agent execution for selective analysis',
    'Enterprise-grade documentation with confidence scoring',
    'Stakeholder-focused outputs with role-based intelligence',
    'Latest Anthropic SDK integration with best practices',
    'Functional agents making real Claude API calls'
  ],
  uiFeatures: [
    'Progressive loading with individual agent results',
    'Real-time status updates and error handling',
    'Selective agent execution based on user preferences',
    'Token usage tracking and cost optimization',
    'Confidence scoring for quality assessment'
  ]
};