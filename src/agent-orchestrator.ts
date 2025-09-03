import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { CSVParserAgent } from './agents/agent-0-csv-parser';
import { DomainClassifierAgent } from './agents/agent-1-domain-classifier';
import { BusinessGlossaryAgent } from './agents/agent-2-business-glossary';
import { DataArchitectureAgent } from './agents/agent-3-data-architecture';
import { DAXAnalyzerAgent } from './agents/agent-4-dax-analyzer';
import { ReportSynthesisAgent } from './agents/agent-5-report-synthesis';
import { ContentPolishAgent } from './agents/agent-6-content-polish';
import { AgentResult, AgentContext, AgentProgressCallback } from './agents/base-agent';
import { ClaudeClient, ClaudeConfig } from './claude-config';
import { withRetry } from './helpers/retry';

export interface OrchestrationResult {
  dataIngestion: AgentResult;
  domainAnalysis: AgentResult;
  businessGlossary: AgentResult;
  dataArchitecture: AgentResult;
  daxAnalysis: AgentResult;
  reportSynthesis: AgentResult;
  contentPolish: AgentResult;
  finalReport: AgentResult;
  metadata: {
    processingTime: number;
    overallConfidence: number;
    recommendedActions: string[];
    artifactsDir?: string;
  };
}

export class AgentOrchestrator {
  private agent0: CSVParserAgent;
  private agent1: DomainClassifierAgent;
  private agent2: BusinessGlossaryAgent;
  private agent3: DataArchitectureAgent;
  private agent4: DAXAnalyzerAgent;
  private agent5: ReportSynthesisAgent;
  private agent6: ContentPolishAgent;
  private claudeClient: ClaudeClient;

  constructor(config?: Partial<ClaudeConfig>) {
    this.claudeClient = new ClaudeClient({
      model: config?.model ?? process.env.CLAUDE_MODEL ?? 'claude-3.5-sonnet',
      maxTokens: config?.maxTokens ?? 4000,
      timeout: config?.timeout ?? 120_000,
      ...(config || {})
    });

    this.agent0 = new CSVParserAgent();
    this.agent1 = new DomainClassifierAgent();
    this.agent2 = new BusinessGlossaryAgent();
    this.agent3 = new DataArchitectureAgent();
    this.agent4 = new DAXAnalyzerAgent();
    this.agent5 = new ReportSynthesisAgent();
    this.agent6 = new ContentPolishAgent();
  }

  async orchestrateFromDirectory(
    directory: string,
    progressCallback?: AgentProgressCallback,
    measureCount: string | number = 'all'
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();
    console.log('🚀 DAX Catalog Complete Agent Pipeline - Hybrid Architecture');
    console.log('='.repeat(60));
    console.log('\n📁 STEP 0: CSV Data Ingestion...');

    const dataResult = await this.agent0.parseDirectory(directory, measureCount);
    const context = {
      ...this.agent0.extractParsedContext(dataResult),
      directory,
      maxMeasures: measureCount === 'all' ? 999 : Number(measureCount) || 999
    } as AgentContext;

    console.log(`✅ Data ingested: ${context.measures?.length} measures, ${context.tables?.length} tables`);
    return this.orchestrateWithSharedClient(context, dataResult, startTime, progressCallback);
  }

  async orchestrateAnalysis(context: AgentContext, progressCallback?: AgentProgressCallback): Promise<OrchestrationResult> {
    return this.orchestrateWithSharedClient(context, null, Date.now(), progressCallback);
  }

  private async orchestrateWithSharedClient(
    context: AgentContext,
    dataResult: AgentResult | null,
    startTime: number,
    progressCallback?: AgentProgressCallback
  ): Promise<OrchestrationResult> {
    if (!dataResult) {
      console.log('🚀 DAX Catalog Agent Orchestration - Hybrid Architecture');
      console.log('='.repeat(60));
    }

    // STEP 1
    console.log('\n🔍 STEP 1: Domain Classification Analysis...');
    const domainResult = await withRetry(() => this.agent1.analyze(context, this.claudeClient, progressCallback));
    const enrichedContext = { ...context, ...this.agent1.extractDomainContext(domainResult) };
    console.log(`✅ Domain classified: ${enrichedContext.domain}`);
    console.log(`👥 Stakeholders identified: ${enrichedContext.stakeholders?.join(', ')}`);

    // STEP 2 (parallel, resilient)
    console.log('\n⚡ STEP 2: Parallel Agent Processing...');
    console.log('  - Agent 2: Business Glossary & Terminology');
    console.log('  - Agent 3: Data Architecture Intelligence');
    console.log('  - Agent 4: DAX Analysis & Measure Interpretation');

    // Concurrency limit to avoid API rate limits
    const limit = pLimit(3);
    
    const hasMeasures = (enrichedContext.measures?.length ?? 0) > 0;

    const daxPromise = hasMeasures
      ? limit(() => withRetry(() => this.agent4.analyze(enrichedContext, this.claudeClient, progressCallback)))
      : Promise.resolve({
          agentType: 'DAX Analyzer & Measure Interpretation',
          analysis: 'No measures found in input; DAX analysis skipped.',
          confidence: 1.0,
          metadata: {
            inputData: { measuresCount: 0, analyzed: 0, complexMeasures: [] },
            lintFindings: [],
            lintSummary: { warnings: 0, infos: 0, errors: 0 }
          },
          timestamp: new Date()
        } as AgentResult);

    const [gRes, aRes, dRes] = await Promise.allSettled([
      limit(() => withRetry(() => this.agent2.analyze(enrichedContext, this.claudeClient, progressCallback))),
      limit(() => withRetry(() => this.agent3.analyze(enrichedContext, this.claudeClient, progressCallback))),
      daxPromise
    ]);

    const glossaryResult     = gRes.status === 'fulfilled' ? gRes.value : this.fallback('Business Glossary', (gRes as any).reason);
    const architectureResult = aRes.status === 'fulfilled' ? aRes.value : this.fallback('Data Architecture', (aRes as any).reason);
    const daxResult          = dRes.status === 'fulfilled' ? dRes.value : this.fallback('DAX Analysis', (dRes as any).reason);

    console.log('✅ Parallel processing completed');

    // STEP 3
    console.log('\n📊 STEP 3: Report Synthesis & Integration...');
    const synthesisInputs = {
      domainAnalysis: domainResult,
      businessGlossary: glossaryResult,
      dataArchitecture: architectureResult,
      daxAnalysis: daxResult
    };
    const reportSynthesis = await withRetry(() =>
      this.agent5.synthesizeResults(synthesisInputs, enrichedContext, this.claudeClient)
    );
    console.log('✅ Report synthesis completed');

    // Normalize synthesis JSON for polish
    let synthesisObj: any;
    try {
      synthesisObj = typeof reportSynthesis.analysis === 'string'
        ? JSON.parse(reportSynthesis.analysis as string)
        : reportSynthesis.analysis;
    } catch {
      const m = String(reportSynthesis.analysis).match(/\{[\s\S]*\}$/);
      synthesisObj = m ? JSON.parse(m[0]) : { overview:{}, measures:[], tables:[], relationships:[] };
    }

    // STEP 4
    console.log('\n✨ STEP 4: Content Polish & Review...');

    // Fixed stats passed to Agent 6 (prevents fallback "Business Intelligence" + 0/0/0)
    const stats = {
      domain: enrichedContext.domain ?? context.domain ?? 'Business Intelligence',
      tables: context.tables?.length ?? 0,
      measures: context.measures?.length ?? 0,
      relationships: context.relationships?.length ?? 0
    };

    const polishContext = { 
      ...enrichedContext, 
      rawReport: synthesisObj, 
      stats,
      businessGlossary: (() => {
        try { return JSON.parse(String(glossaryResult.analysis)); } catch { return {}; }
      })()
    };
    const contentPolish = await withRetry(() => this.agent6.analyze(polishContext, this.claudeClient, progressCallback));
    console.log('✅ Content polished and reviewed for publication');

    // optional UI/export artifacts from Agent 6
    const uiHtml = String((contentPolish.metadata as any)?.uiContent ?? '');
    const mdOut  = String((contentPolish.metadata as any)?.markdownExport ?? '');
    const csvOut = String((contentPolish.metadata as any)?.csvExport ?? '');

    // Generate contextual insights from all agents
    const contextualInsights = this.generateContextualInsights(
      domainResult,
      glossaryResult, 
      architectureResult,
      daxResult,
      reportSynthesis,
      contentPolish,
      enrichedContext
    );

    // Apply contextual enhancements to final output
    const enhancedPayload = this.applyContextualEnhancements(contentPolish.analysis, contextualInsights);

    // Final payload normalization
    let finalPayload = enhancedPayload;
    try {
      finalPayload = typeof finalPayload === 'string' ? finalPayload : JSON.stringify(finalPayload);
    } catch { /* keep as-is */ }

    // Size guard for web UI
    const MAX_BYTES = 2_000_000;
    try {
      const bytes = Buffer.byteLength(String(finalPayload), 'utf8');
      if (bytes > MAX_BYTES) {
        const obj = JSON.parse(String(finalPayload));
        obj.measures?.forEach((m: any) => { delete m.tests; delete m.longExamples; });
        finalPayload = JSON.stringify(obj);
      }
    } catch {/* noop */}

    // Safety patch: ensure measures and table columns are populated
    try {
      const obj = JSON.parse(String(finalPayload));
      // fill measures if empty
      if (!Array.isArray(obj.measures) || obj.measures.length === 0) {
        obj.measures = (context.measures || []).map(m => ({
          name: m.name,
          businessMeaning: '',
          whenToUse: '',
          successIndicators: '',
          dax: (m as any).expression || '',
          folder: (m as any).displayFolder || '',
          description: (m as any).description || ''
        }));
      }
      // fill table column counts
      const colCounts = new Map<string, number>();
      (context.columns || []).forEach(c => {
        const key = (c.tableName || '').toLowerCase();
        colCounts.set(key, (colCounts.get(key) || 0) + 1);
      });
      if (Array.isArray(obj.tables)) {
        obj.tables = obj.tables.map((t: any) => ({
          ...t,
          columns: colCounts.get((t.name || '').toLowerCase()) || t.columns || 0
        }));
      }
      finalPayload = JSON.stringify(obj);
    } catch { /* keep as-is */ }

    // Write artifacts for web app (also persist UI/MD/CSV if present)
    const artifactsDir = this.writeArtifacts(
      (context as any).directory || process.cwd(),
      String(finalPayload),
      typeof reportSynthesis.analysis === 'string' ? reportSynthesis.analysis : JSON.stringify(reportSynthesis.analysis),
      uiHtml,
      mdOut,
      csvOut,
      context
    );

    // Metrics
    const processingTime = Date.now() - startTime;
    const overallConfidence = this.calculateOverallConfidence([
      domainResult, glossaryResult, architectureResult, daxResult, reportSynthesis, contentPolish
    ]);

    const result: OrchestrationResult = {
      dataIngestion: dataResult || { agentType: 'Skipped', analysis: 'No CSV parsing performed', confidence: 1.0, metadata: {}, timestamp: new Date() },
      domainAnalysis: domainResult,
      businessGlossary: glossaryResult,
      dataArchitecture: architectureResult,
      daxAnalysis: daxResult,
      reportSynthesis,
      contentPolish,
      finalReport: { ...contentPolish, analysis: String(finalPayload) },
      metadata: {
        processingTime,
        overallConfidence,
        recommendedActions: this.extractRecommendedActions(contentPolish),
        artifactsDir
      }
    };

    console.log('\n🎉 ORCHESTRATION COMPLETE');
    console.log(`⏱️  Processing time: ${processingTime}ms`);
    console.log(`🎯 Overall confidence: ${(overallConfidence * 100).toFixed(1)}%`);
    console.log(`📁 Artifacts: ${artifactsDir}`);
    console.log('='.repeat(60));

    return result;
  }

  private calculateOverallConfidence(results: AgentResult[]): number {
    const weight = (r: AgentResult) =>
      /DAX|Synthesis|Polish/i.test(String(r.agentType)) ? 2 : 1;

    let sum = 0, w = 0;
    for (const r of results) {
      const c = Number(r?.confidence);
      if (Number.isFinite(c)) { sum += c * weight(r); w += weight(r); }
    }
    return w ? sum / w : 0;
  }

  private extractRecommendedActions(_finalReport: AgentResult): string[] {
    return [
      'Deploy documentation to stakeholder portals',
      'Schedule training sessions for business users',
      'Implement automated report refresh workflows',
      'Establish data quality monitoring'
    ];
  }

  private fallback(agentType: string, err: any): AgentResult {
    console.log(`⚠️  ${agentType} failed, providing fallback data: ${err?.message || err}`);
    
    // Provide meaningful fallback data instead of just error messages
    let fallbackAnalysis: any;
    
    switch (agentType) {
      case 'Business Glossary':
        fallbackAnalysis = {
          overview: { domain: 'Unknown', primaryUse: 'Data analysis', stakeholders: [], categories: [], notes: [] },
          terms: [],
          metricQuickRef: [],
          confidence: 0
        };
        break;
      
      case 'Data Architecture':
        fallbackAnalysis = {
          overview: { tables: 0, columns: 0, relationships: 0, schemaType: 'Unknown', notes: [] },
          tables: [],
          relationships: [],
          lineage: [],
          governance: { hiddenTables: [], hiddenColumns: [], dataQualityFlags: [], risks: [] },
          issues: [],
          confidence: 0
        };
        break;
      
      case 'DAX Analysis':
        fallbackAnalysis = [];
        break;
      
      default:
        fallbackAnalysis = `Agent failed: ${String(err?.message || err)}`;
    }

    return {
      agentType,
      analysis: JSON.stringify(fallbackAnalysis),
      confidence: 0,
      metadata: { 
        error: String(err?.stack || err),
        fallbackProvided: true,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date(),
    };
  }

  private writeArtifacts(
    dir: string,
    finalReportJson: string,
    synthesisJson?: string,
    uiHtml?: string,
    markdown?: string,
    csv?: string,
    context?: AgentContext
  ) {
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    
    // Create metadata artifact with versioning
    const metadata = {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      counts: {
        measures: context?.measures?.length || 0,
        tables: context?.tables?.length || 0,
        columns: context?.columns?.length || 0,
        relationships: context?.relationships?.length || 0
      },
      domain: context?.domain || 'Analytics Model',
      pipeline: {
        agent0: 'CSV Parser & Data Ingestion',
        agent1: 'Domain Classification',
        agent2: 'Business Glossary & Terminology', 
        agent3: 'Data Architecture Intelligence',
        agent4: 'DAX Analysis & Measure Interpretation',
        agent5: 'Report Synthesis & Integration',
        agent6: 'Content Polish & Review'
      },
      artifacts: {
        'final_report.json': 'Complete analysis results',
        'synthesis.json': 'Pre-polish synthesis data',
        'model_documentation.html': 'HTML documentation',
        'model_documentation.md': 'Markdown documentation', 
        'model_kpis.csv': 'KPI export',
        'meta.json': 'Generation metadata'
      }
    };
    
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(metadata, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'final_report.json'), finalReportJson, 'utf8');
    if (synthesisJson) fs.writeFileSync(path.join(outDir, 'synthesis.json'), synthesisJson, 'utf8');
    if (uiHtml && uiHtml.trim()) fs.writeFileSync(path.join(outDir, 'model_documentation.html'), uiHtml, 'utf8');
    if (markdown && markdown.trim()) fs.writeFileSync(path.join(outDir, 'model_documentation.md'), markdown, 'utf8');
    if (csv && csv.trim()) fs.writeFileSync(path.join(outDir, 'model_kpis.csv'), csv, 'utf8');
    return outDir;
  }

  generateSummary(result: OrchestrationResult): string {
    return `
📋 DAX CATALOG ANALYSIS SUMMARY
${'='.repeat(40)}
Domain: ${result.domainAnalysis.metadata?.domain || 'Classified'}
Stakeholders: ${result.domainAnalysis.metadata?.stakeholders?.length || 0} groups identified
Measures Analyzed: ${result.daxAnalysis.metadata?.inputData?.measuresCount || 0}
Tables Processed: ${result.dataArchitecture.metadata?.inputData?.tablesCount || 0}
Processing Time: ${result.metadata.processingTime}ms
Overall Confidence: ${(result.metadata.overallConfidence * 100).toFixed(1)}%

Artifacts: ${result.metadata.artifactsDir}
🎯 READY FOR DEPLOYMENT
`;
  }

  private generateContextualInsights(
    domainResult: AgentResult,
    glossaryResult: AgentResult, 
    architectureResult: AgentResult,
    daxResult: AgentResult,
    reportSynthesis: AgentResult,
    contentPolish: AgentResult,
    context: AgentContext
  ) {
    // Safely parse each agent's data with fallbacks
    const domainData = this.safeParseJson(domainResult.analysis) || { 
      domain: 'Unknown', 
      stakeholders: { primary: [], management: [], support: [] },
      executiveSummary: { purpose: 'Data analysis system' },
      confidence: 0.5
    };
    
    const glossaryData = this.safeParseJson(glossaryResult.analysis) || {
      overview: { stakeholders: [], categories: [] },
      terms: [],
      metricQuickRef: []
    };
    
    const archData = this.safeParseJson(architectureResult.analysis) || {
      overview: { schemaType: 'Unknown', notes: [] },
      tables: [],
      relationships: [],
      governance: { risks: [] },
      issues: []
    };
    
    const daxData = this.safeParseJson(daxResult.analysis) || [];
    const synthesisData = this.safeParseJson(reportSynthesis.analysis) || { measures: [] };

    return {
      businessUserGuidance: this.generateBusinessUserGuidance(glossaryData, domainData, synthesisData),
      executiveSummaryInsights: this.generateExecutiveSummaryInsights(domainData, archData, daxData, context),
      modelImprovementRecommendations: this.generateModelImprovementRecommendations(archData, daxData, glossaryData),
      enhancedDAXFixes: this.enhanceDAXFixes(daxData),
      dataLineageContext: this.generateDataLineageContext(archData),
      usageGuidanceEnhancements: this.generateUsageGuidanceEnhancements(glossaryData, domainData),
      stakeholderTerminology: this.generateStakeholderTerminology(glossaryData, domainData)
    };
  }

  private generateBusinessUserGuidance(glossaryData: any, domainData: any, synthesisData: any) {
    const guidance = [];
    
    // From glossary: extract when-to-use patterns
    const quickRef = Array.isArray(glossaryData?.metricQuickRef) ? glossaryData.metricQuickRef : [];
    if (quickRef.length > 0) {
      const usagePatterns = quickRef
        .filter((m: any) => m?.name) // Only include items with names
        .map((m: any) => ({
          measure: m.name,
          guidance: m.whenToUse || 'Use as needed',
          indicators: Array.isArray(m.successIndicators) ? m.successIndicators : []
        }));
      
      if (usagePatterns.length > 0) {
        guidance.push({
          category: 'Metric Usage Patterns',
          items: usagePatterns
        });
      }
    }

    // From domain: stakeholder-specific guidance
    const primaryStakeholders = Array.isArray(domainData?.stakeholders?.primary) 
      ? domainData.stakeholders.primary 
      : [];
      
    if (primaryStakeholders.length > 0) {
      guidance.push({
        category: 'Stakeholder Focus Areas',
        items: primaryStakeholders
          .filter((role: any) => typeof role === 'string')
          .slice(0, 3) // Limit to top 3 stakeholders for brevity
          .map((role: string) => ({
            role,
            focus: this.getStakeholderFocus(role, Array.isArray(synthesisData?.measures) ? synthesisData.measures : [])
          }))
      });
    }

    return guidance.length > 0 ? guidance : [{
      category: 'General Guidance',
      items: [{ 
        role: 'All Users', 
        focus: 'Use this model for data analysis and reporting needs'
      }]
    }];
  }

  private generateExecutiveSummaryInsights(domainData: any, archData: any, daxData: any, context: AgentContext) {
    const insights = [];

    // Model maturity assessment with safe data access
    const schemaType = archData?.overview?.schemaType || 'Unknown';
    const governanceIssues = Array.isArray(archData?.governance?.risks) ? archData.governance.risks.length : 0;
    const daxComplexity = this.analyzeDaxComplexity(Array.isArray(daxData) ? daxData : []);
    
    insights.push({
      category: 'Model Maturity',
      score: this.calculateMaturityScore(schemaType, governanceIssues, daxComplexity),
      details: {
        architecture: schemaType,
        governanceHealth: governanceIssues === 0 ? 'Clean' : `${governanceIssues} issue${governanceIssues > 1 ? 's' : ''} identified`,
        measureComplexity: daxComplexity
      }
    });

    // Business readiness with safe data access
    const domainConfidence = typeof domainData?.confidence === 'number' ? domainData.confidence : 0.5;
    const primaryCount = Array.isArray(domainData?.stakeholders?.primary) ? domainData.stakeholders.primary.length : 0;
    const managementCount = Array.isArray(domainData?.stakeholders?.management) ? domainData.stakeholders.management.length : 0;
    const stakeholderCoverage = primaryCount + managementCount;
    
    insights.push({
      category: 'Business Readiness', 
      score: Math.min(0.95, (domainConfidence * 0.7) + (Math.min(stakeholderCoverage / 8, 1) * 0.3)),
      details: {
        domainClarity: domainConfidence > 0.8 ? 'High' : domainConfidence > 0.6 ? 'Medium' : 'Low',
        stakeholderAlignment: stakeholderCoverage > 0 
          ? `${stakeholderCoverage} stakeholder group${stakeholderCoverage > 1 ? 's' : ''} identified`
          : 'No stakeholders identified',
        businessContext: domainData?.executiveSummary?.purpose || domainData?.domain || 'Data analysis system'
      }
    });

    return insights;
  }

  private generateModelImprovementRecommendations(archData: any, daxData: any, glossaryData: any) {
    const recommendations = [];

    // Architecture improvements
    const archIssues = archData.issues || [];
    const govRisks = archData.governance?.risks || [];
    if (archIssues.length > 0 || govRisks.length > 0) {
      recommendations.push({
        priority: 'High',
        category: 'Data Architecture',
        items: [...archIssues, ...govRisks].slice(0, 5)
      });
    }

    // DAX improvements
    const daxFixes = Array.isArray(daxData) ? daxData.flatMap((m: any) => m.suggestedFixes || []) : [];
    if (daxFixes.length > 0) {
      recommendations.push({
        priority: 'Medium',
        category: 'DAX Formula Optimization',
        items: daxFixes.slice(0, 3).map((fix: any) => `${fix.title}: ${fix.rationale}`)
      });
    }

    // Business context improvements
    const terms = glossaryData.terms || [];
    const termsWithoutDefinitions = terms.filter((t: any) => !t.definition || t.definition.length < 10);
    if (termsWithoutDefinitions.length > 0) {
      recommendations.push({
        priority: 'Low',
        category: 'Business Documentation',
        items: [`Complete definitions for ${termsWithoutDefinitions.length} business terms`]
      });
    }

    return recommendations;
  }

  private enhanceDAXFixes(daxData: any) {
    if (!Array.isArray(daxData)) return [];
    
    return daxData.map((measure: any) => ({
      measureName: measure.measureName,
      complexity: measure.complexity,
      risks: measure.risks || [],
      enhancedFixes: (measure.suggestedFixes || []).map((fix: any) => ({
        ...fix,
        impact: this.assessFixImpact(fix.title),
        implementationEffort: this.assessImplementationEffort(fix.fixedDax),
        businessBenefit: this.assessBusinessBenefit(fix.title, measure.risks)
      }))
    })).filter(m => m.enhancedFixes.length > 0);
  }

  private generateDataLineageContext(archData: any) {
    const lineage = archData.lineage || [];
    const relationships = archData.relationships || [];
    
    // Key entity identification
    const tables = archData.tables || [];
    const factTables = tables.filter((t: any) => t.role === 'fact').map((t: any) => t.name);
    const dimTables = tables.filter((t: any) => t.role === 'dimension').map((t: any) => t.name);
    
    return {
      keyEntities: {
        factTables,
        dimensionTables: dimTables,
        calendarTables: tables.filter((t: any) => t.role === 'calendar').map((t: any) => t.name)
      },
      relationshipPatterns: this.analyzeRelationshipPatterns(relationships),
      dataFlow: lineage.map((l: any) => ({
        from: l.source,
        to: l.target,
        via: l.via || 'Direct relationship'
      }))
    };
  }

  private generateUsageGuidanceEnhancements(glossaryData: any, domainData: any) {
    const terms = glossaryData.terms || [];
    const quickRef = glossaryData.metricQuickRef || [];
    
    return {
      measureGuidance: quickRef.map((m: any) => ({
        name: m.name,
        whenToUse: m.whenToUse,
        successIndicators: m.successIndicators,
        relatedTerms: this.findRelatedTerms(m.name, terms)
      })),
      businessProcessAlignment: this.alignWithBusinessProcesses(domainData.businessProcesses || [], quickRef),
      cadenceRecommendations: this.generateCadenceRecommendations(quickRef)
    };
  }

  private generateStakeholderTerminology(glossaryData: any, domainData: any) {
    const stakeholderGroups = {
      primary: domainData.stakeholders?.primary || [],
      management: domainData.stakeholders?.management || [],
      support: domainData.stakeholders?.support || []
    };

    const terms = glossaryData.terms || [];
    
    return Object.entries(stakeholderGroups).reduce((acc, [level, roles]) => {
      acc[level] = {
        roles,
        relevantTerms: this.getStakeholderRelevantTerms(roles, terms),
        keyMetrics: this.getStakeholderKeyMetrics(roles, glossaryData.metricQuickRef || [])
      };
      return acc;
    }, {} as any);
  }

  private applyContextualEnhancements(originalAnalysis: any, insights: any) {
    const analysis = this.safeParseJson(originalAnalysis) || {};
    
    // Add new contextual sections
    analysis.businessUserGuidance = insights.businessUserGuidance;
    analysis.executiveInsights = insights.executiveSummaryInsights;
    analysis.improvementRoadmap = insights.modelImprovementRecommendations;
    analysis.dataLineage = insights.dataLineageContext;
    analysis.stakeholderContext = insights.stakeholderTerminology;
    
    // Enhance existing measures with DAX fixes
    if (Array.isArray(analysis.measures) && insights.enhancedDAXFixes.length > 0) {
      analysis.measures = analysis.measures.map((measure: any) => {
        const enhanced = insights.enhancedDAXFixes.find((fix: any) => 
          fix.measureName.toLowerCase() === measure.name.toLowerCase()
        );
        if (enhanced) {
          measure.enhancedFixes = enhanced.enhancedFixes;
          measure.complexityAssessment = {
            level: enhanced.complexity,
            risks: enhanced.risks
          };
        }
        return measure;
      });
    }
    
    // Add usage guidance to overview
    if (analysis.overview) {
      analysis.overview.usageGuidance = insights.usageGuidanceEnhancements;
    }

    return JSON.stringify(analysis);
  }

  // Helper methods
  private safeParseJson(data: any): any {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch { return null; }
    }
    return data;
  }

  private getStakeholderFocus(role: string, measures: any[]): string {
    // Generic focus based on role patterns, not specific domains
    const lowerRole = role.toLowerCase();
    if (lowerRole.includes('manager') || lowerRole.includes('director')) {
      return 'Operational metrics and team performance indicators';
    }
    if (lowerRole.includes('executive') || lowerRole.includes('vp') || lowerRole.includes('ceo')) {
      return 'High-level KPIs and strategic indicators';
    }
    if (lowerRole.includes('analyst') || lowerRole.includes('specialist')) {
      return 'Detailed breakdowns and trend analysis';
    }
    if (lowerRole.includes('finance') || lowerRole.includes('financial')) {
      return 'Financial performance and cost metrics';
    }
    return 'Core business metrics relevant to role';
  }

  private analyzeDaxComplexity(daxData: any[]): string {
    if (!Array.isArray(daxData)) return 'Unknown';
    const complexCounts = daxData.reduce((acc, m) => {
      acc[m.complexity || 'medium'] = (acc[m.complexity || 'medium'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const total = daxData.length;
    if ((complexCounts.complex || 0) / total > 0.3) return 'High';
    if ((complexCounts.simple || 0) / total > 0.6) return 'Low';
    return 'Medium';
  }

  private calculateMaturityScore(schemaType: string, govIssues: number, daxComplexity: string): number {
    let score = 0.7;
    if (schemaType === 'Star') score += 0.15;
    else if (schemaType === 'Snowflake') score += 0.1;
    
    score -= Math.min(govIssues * 0.05, 0.2);
    
    if (daxComplexity === 'Low') score += 0.05;
    else if (daxComplexity === 'High') score -= 0.05;
    
    return Math.max(0.4, Math.min(0.95, score));
  }

  private assessFixImpact(title: string): string {
    // Generic assessment based on common DAX improvement categories
    if (/\b(performance|efficiency|optimize|faster|speed)\b/i.test(title)) return 'High';
    if (/\b(error|risk|issue|problem|failure)\b/i.test(title)) return 'Medium';
    if (/\b(replace|substitute|alternative)\b/i.test(title)) return 'Medium';
    if (/\b(readability|clarity|simplify|clean)\b/i.test(title)) return 'Low';
    return 'Low';
  }

  private assessImplementationEffort(dax: string): string {
    if (!dax) return 'Low';
    
    // Count complexity indicators
    const complexityMarkers = [
      /\bVAR\b/g, /\bRETURN\b/g, /\bCALCULATE\b/g, 
      /\bFILTER\b/g, /\bSUMX\b/g, /\bAVERAGEX\b/g
    ];
    
    const complexityScore = complexityMarkers.reduce((score, pattern) => 
      score + (dax.match(pattern) || []).length, 0);
    
    if (dax.length > 300 || complexityScore > 5) return 'High';
    if (dax.length > 150 || complexityScore > 2) return 'Medium';
    return 'Low';
  }

  private assessBusinessBenefit(title: string, risks: string[]): string {
    // High benefit: performance and accuracy improvements
    const riskText = risks.join(' ').toLowerCase();
    if (/\b(performance|slow|timeout|memory|cpu)\b/i.test(riskText)) return 'High';
    if (/\b(accuracy|correctness|calculation|wrong|incorrect)\b/i.test(title + ' ' + riskText)) return 'High';
    if (/\b(maintainability|readability|best.practice)\b/i.test(title)) return 'Medium';
    return 'Medium';
  }

  private analyzeRelationshipPatterns(relationships: any[]): any {
    const patterns = {
      totalRelationships: relationships.length,
      manyToOne: relationships.filter(r => r.cardinality === 'Many-to-One').length,
      oneToMany: relationships.filter(r => r.cardinality === 'One-to-Many').length,
      inactive: relationships.filter(r => r.active === false).length
    };
    return patterns;
  }

  private findRelatedTerms(measureName: string, terms: any[]): string[] {
    return terms.filter(t => 
      (t.related || []).includes(measureName) || 
      t.term.toLowerCase().includes(measureName.toLowerCase().split(' ')[0])
    ).map(t => t.term).slice(0, 3);
  }

  private alignWithBusinessProcesses(processes: string[], metrics: any[]): any[] {
    return processes.map(process => {
      const processKeywords = process.toLowerCase().split(/\s+/);
      return {
        process,
        relevantMetrics: metrics.filter(m => {
          const metricText = (m.name + ' ' + (m.whenToUse || '')).toLowerCase();
          // Match on any keyword from the process name
          return processKeywords.some(keyword => 
            keyword.length > 2 && metricText.includes(keyword)
          );
        }).map(m => m.name)
      };
    });
  }

  private generateCadenceRecommendations(metrics: any[]): any[] {
    return metrics.map(m => ({
      metric: m.name,
      suggestedCadence: this.inferCadence(m.whenToUse)
    }));
  }

  private inferCadence(whenToUse: string): string {
    if (!whenToUse) return 'As needed';
    
    const text = whenToUse.toLowerCase();
    
    // Explicit time references
    if (/\b(daily|day|everyday)\b/.test(text)) return 'Daily';
    if (/\b(weekly|week|weekly)\b/.test(text)) return 'Weekly';  
    if (/\b(monthly|month)\b/.test(text)) return 'Monthly';
    if (/\b(quarterly|quarter|q[1-4])\b/.test(text)) return 'Quarterly';
    if (/\b(annual|yearly|year)\b/.test(text)) return 'Annual';
    
    // Activity-based inference
    if (/\b(real.?time|live|continuous|ongoing)\b/.test(text)) return 'Real-time';
    if (/\b(meeting|review|report)\b/.test(text)) return 'Weekly';
    if (/\b(planning|forecast|budget)\b/.test(text)) return 'Monthly';
    if (/\b(strategic|board|executive)\b/.test(text)) return 'Quarterly';
    
    return 'As needed';
  }

  private getStakeholderRelevantTerms(roles: string[], terms: any[]): string[] {
    return terms.filter(t => {
      const termText = (t.term + ' ' + t.definition).toLowerCase();
      return roles.some(role => 
        termText.includes(role.toLowerCase()) ||
        this.isRoleRelevant(role, t.kind)
      );
    }).map(t => t.term);
  }

  private getStakeholderKeyMetrics(roles: string[], metrics: any[]): string[] {
    return metrics.filter(m => {
      const metricText = (m.name + ' ' + m.whenToUse).toLowerCase();
      return roles.some(role => 
        metricText.includes(role.toLowerCase()) ||
        this.isMetricRelevantToRole(role, m.name)
      );
    }).map(m => m.name);
  }

  private isRoleRelevant(role: string, kind: string): boolean {
    if (role.toLowerCase().includes('executive') && kind === 'measure') return true;
    if (role.toLowerCase().includes('analyst') && kind === 'column') return true;
    return kind === 'measure';
  }

  private isMetricRelevantToRole(role: string, metricName: string): boolean {
    // Generic patterns based on role types, not domain-specific terms
    const lowerRole = role.toLowerCase();
    const lowerMetric = metricName.toLowerCase();
    
    // Executive roles: totals, summaries, high-level metrics
    if (lowerRole.includes('executive') || lowerRole.includes('ceo') || lowerRole.includes('vp')) {
      return /^(total|sum|count|average|overall|aggregate|summary)/.test(lowerMetric) ||
             /\b(performance|score|index|ratio)\b/.test(lowerMetric);
    }
    
    // Manager roles: team and operational metrics
    if (lowerRole.includes('manager') || lowerRole.includes('director')) {
      return /\b(count|volume|rate|efficiency|utilization)\b/.test(lowerMetric);
    }
    
    // Analyst roles: any detailed metric
    if (lowerRole.includes('analyst') || lowerRole.includes('specialist')) {
      return true; // Analysts typically need access to all metrics
    }
    
    // Finance roles: financial and numeric metrics
    if (lowerRole.includes('finance') || lowerRole.includes('financial')) {
      return /\b(amount|value|cost|price|margin|revenue|total)\b/.test(lowerMetric);
    }
    
    // Default: basic aggregation metrics are relevant to most roles
    return /^(total|count|sum|average)/.test(lowerMetric);
  }
}
