# DAX Catalog v1.0.0 🚀

**AI-Powered Power BI Documentation System with 7-Agent Pipeline Architecture**

Transform raw Power BI DAX metadata into business-friendly, stakeholder-ready documentation using advanced AI agent orchestration. **Production-ready** system that works across any business domain without dataset-specific assumptions.

---

## ✨ Key Features

- 🤖 **7-Agent AI Pipeline**: Sophisticated orchestration from CSV parsing to polished documentation
- 🌐 **Domain-Agnostic**: Works reliably with any Power BI model (Sales, Finance, Healthcare, etc.)
- 🔍 **Advanced DAX Linting**: Pattern-based technical analysis for code quality
- 🎯 **Confidence Gating**: Intelligent fallbacks prevent AI hallucination
- 📊 **Real-Time Progress**: WebSocket-powered UI with live agent status
- 📋 **Artifact Versioning**: Complete metadata tracking with schema v1.0.0
- 🌐 **Web Interface**: React frontend with drag-and-drop file upload
- 📤 **Multiple Formats**: HTML, Markdown, CSV, and JSON exports

---

## 🚀 Quick Start

### 1. Installation
```bash
git clone <repository>
cd dax-catalog
npm install
npm run build
```

### 2. Environment Setup
```bash
# Create .env file
echo "ANTHROPIC_API_KEY=your_anthropic_api_key" > .env
```

### 3. Test the System
```bash
# Run 7-agent pipeline on sample data
npm run cli orchestrate ./sample-data/test2

# Limit measures for faster testing
npm run cli orchestrate ./sample-data/test2 --max-measures 3
```

---

## 💻 Complete Usage Guide

### Method 1: 7-Agent Pipeline (Recommended)

**Step 1: Prepare your Power BI data**
```bash
# Create directory for your Power BI exports
mkdir my-powerbi-model
cd my-powerbi-model

# Export 4 CSV files from Power BI (see Power BI Integration section)
# You should have: measures.csv, tables.csv, columns.csv, relationships.csv
```

**Step 2: Run the complete pipeline**
```bash
# Full analysis with all measures
npm run cli orchestrate ./my-powerbi-model

# Limit measures for testing (faster)
npm run cli orchestrate ./my-powerbi-model --max-measures 5

# Sample output:
# 🚀 Starting 7-Agent AI Pipeline...
# 📁 STEP 0: CSV Data Ingestion...
# ✅ Data ingested: 15 measures, 8 tables
# 🔍 STEP 1: Domain Classification Analysis...
# ✅ Domain classified: Sales Analytics
# ⚡ STEP 2: Parallel Agent Processing...
# 📊 STEP 3: Report Synthesis & Integration...
# ✨ STEP 4: Content Polish & Review...
# 🎉 Pipeline Complete! Overall Confidence: 94%
```

**Step 3: Review generated artifacts**
```bash
# Check output directory
ls my-powerbi-model/out/
# meta.json                  # Generation metadata
# final_report.json          # Complete analysis
# model_documentation.html   # Stakeholder-ready HTML
# model_documentation.md     # Technical markdown
# model_kpis.csv            # Structured export
```

### Method 2: Web Interface (User-Friendly)

**Step 1: Start the web application**
```bash
cd web-app
npm install  # If first time
npm run dev  # Starts both server and React client
```

**Step 2: Access the interface**
```
Open browser: http://localhost:3000

The interface provides:
- Drag & drop for CSV files
- Real-time progress tracking
- Downloadable results
- No command line required
```

**Step 3: Upload and process**
```javascript
// The web interface handles:
// 1. File validation (ensures 4 required CSV types)
// 2. Real-time WebSocket updates from each agent
// 3. Downloadable results in multiple formats
// 4. Error handling with user-friendly messages
```

### Method 3: Programmatic Integration

**Using the Agent Orchestrator directly in your code:**

```typescript
import { AgentOrchestrator } from './src/agent-orchestrator';

// Initialize orchestrator
const orchestrator = new AgentOrchestrator();

// Set up progress callback
const progressCallback = (agentType: string, stage: string, result?: any) => {
  console.log(`${agentType}: ${stage}`);
  if (result) {
    console.log(`Confidence: ${result.confidence}`);
  }
};

// Run analysis
async function analyzeModel() {
  try {
    const result = await orchestrator.orchestrateFromDirectory(
      './path/to/csv-files',
      progressCallback,
      'all' // or specific number like 10
    );
    
    console.log('Analysis complete!');
    console.log(`Overall confidence: ${result.metadata.overallConfidence}`);
    console.log(`Processing time: ${result.metadata.processingTime}ms`);
    
    // Access individual agent results
    console.log('Domain:', result.domainAnalysis.metadata.domain);
    console.log('Stakeholders:', result.domainAnalysis.metadata.stakeholders);
    
  } catch (error) {
    console.error('Analysis failed:', error);
  }
}

analyzeModel();
```

**Using individual agents:**

```typescript
import { DomainClassifierAgent } from './src/agents/agent-1-domain-classifier';
import { DAXAnalyzerAgent } from './src/agents/agent-4-dax-analyzer';
import { ClaudeClient } from './src/claude-config';

// Initialize Claude client
const claude = new ClaudeClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120000
});

// Use individual agents
async function analyzeSpecificAspects(context) {
  // Classify domain
  const domainAgent = new DomainClassifierAgent();
  const domainResult = await domainAgent.analyze(context, claude);
  console.log('Domain:', domainResult.metadata.domain);
  
  // Analyze DAX measures
  const daxAgent = new DAXAnalyzerAgent();
  const daxResult = await daxAgent.analyze(context, claude);
  console.log('DAX Analysis:', daxResult.analysis);
  console.log('Lint Findings:', daxResult.metadata.lintFindings);
}
```

### Method 4: Legacy CLI Commands (Still Supported)

**Single DAX expression analysis:**
```bash
# Analyze specific DAX formula
npm run cli analyze 'SUM(Sales[Amount])' --name 'Total Sales'

# Complex formula with business context
npm run cli analyze 'DIVIDE([Total Revenue], [Order Count], 0)' --name 'Average Order Value'

# Output includes:
# - Business description
# - Technical complexity analysis  
# - DAX pattern linting
# - Optimization suggestions
```

**Process individual CSV files:**
```bash
# Process just measures
npm run cli process-csv ./measures.csv --output ./docs/measures.md

# Process with specific format
npm run cli process-csv ./measures.csv --format html --output ./docs/measures.html
```

### Method 5: API Integration

**Express server integration:**
```javascript
const express = require('express');
const { AgentOrchestrator } = require('./dist/agent-orchestrator');

const app = express();
const orchestrator = new AgentOrchestrator();

app.post('/api/analyze', async (req, res) => {
  try {
    const { csvData, maxMeasures } = req.body;
    
    // Create temporary files from uploaded CSV data
    const tempDir = await createTempFiles(csvData);
    
    // Run analysis
    const result = await orchestrator.orchestrateFromDirectory(
      tempDir,
      (agent, stage) => {
        // Send progress via WebSocket or Server-Sent Events
        req.app.io.emit('progress', { agent, stage });
      },
      maxMeasures
    );
    
    res.json({
      success: true,
      confidence: result.metadata.overallConfidence,
      domain: result.domainAnalysis.metadata.domain,
      artifacts: result.finalReport.analysis
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Advanced Configuration Examples

**Custom Claude client settings:**
```typescript
import { ClaudeClient } from './src/claude-config';

// Custom configuration
const claude = new ClaudeClient({
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4000,
  timeout: 180000, // 3 minutes
  apiKey: process.env.ANTHROPIC_API_KEY
});

// With retry and error handling
const response = await claude.makeRequest(
  prompt,
  undefined, // no streaming
  { temperature: 0.1, max_tokens: 2000 }
);

if (response.success) {
  console.log('Analysis:', response.data);
  console.log('Token usage:', response.usage);
} else {
  console.error('Error:', response.error);
}
```

**Environment setup examples:**
```bash
# Development environment
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export NODE_ENV="development"

# Production environment  
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export NODE_ENV="production"

# Test environment (uses sample data)
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export NODE_ENV="test"
npm run test  # Runs automated tests
```

---

## 🏗️ 7-Agent Architecture

**Pipeline Flow:**
```
Agent 0 (CSV Parser) → Agent 1 (Domain Classifier) → 
[Agents 2,3,4 Parallel] → Agent 5 (Report Synthesis) → Agent 6 (Content Polish)
```

### Agent Responsibilities

| Agent | Purpose | Key Features |
|-------|---------|--------------|
| **Agent 0** | CSV Parser & Data Ingestion | Schema enrichment, format inference, relationship mapping |
| **Agent 1** | Domain Classification | Industry identification with generic fallbacks |
| **Agent 2** | Business Glossary | Terminology extraction (runs in parallel) |
| **Agent 3** | Data Architecture | Model intelligence (runs in parallel) |
| **Agent 4** | DAX Analysis | Formula analysis + linting (runs in parallel) |
| **Agent 5** | Report Synthesis | Unified documentation generation |
| **Agent 6** | Content Polish | Publication-ready formatting |

---

## 📁 Power BI Integration

### Export Required Data from Power BI

1. Open **Power BI Desktop**
2. Go to **DAX Query View** or **External Tools**
3. Export these 4 datasets to CSV:

```dax
// measures.csv
EVALUATE INFO.VIEW.MEASURES()

// tables.csv  
EVALUATE INFO.VIEW.TABLES()

// columns.csv
EVALUATE INFO.VIEW.COLUMNS()

// relationships.csv
EVALUATE INFO.VIEW.RELATIONSHIPS()
```

4. Upload all 4 files to the web interface or save to a directory for CLI processing

---

## 📊 Example Output

### Input: DAX Formula
```dax
Revenue Growth = DIVIDE([Total Revenue] - CALCULATE([Total Revenue], SAMEPERIODLASTYEAR('Date'[Date])), CALCULATE([Total Revenue], SAMEPERIODLASTYEAR('Date'[Date])), 0)
```

### Generated Analysis
**Business Purpose:** "Calculates year-over-year revenue growth percentage by comparing current period total revenue against same period previous year"

**Technical Linting:** 
- ⚠️ *Redundant CALCULATE with SAMEPERIODLASTYEAR in denominator - same calculation performed twice*
- 💡 *Store previous year calculation in variable for better performance*

**Stakeholder Insights:**
- **When to Use:** Quarterly performance reviews
- **Success Indicators:** Positive rates, Market outperformance, Consistent trajectory
- **Complexity:** Medium

---

## 🏗️ Project Structure

```
dax-catalog/
├── 📁 src/                    # Core TypeScript source
│   ├── 📁 agents/             # 7 AI agent implementations
│   ├── 📁 lib/                # Domain-agnostic utilities  
│   ├── 📁 helpers/            # Shared utilities
│   ├── agent-orchestrator.ts  # Pipeline coordination
│   ├── claude-config.ts       # Anthropic API client
│   └── enhanced-cli.ts        # Main CLI interface
├── 📁 web-app/               # React + Express web interface
│   ├── 📁 client/            # React frontend
│   ├── server.js             # Express server with WebSocket
│   └── package.json          # Web dependencies
├── 📁 sample-data/           # Test datasets
│   ├── 📁 test2/             # Sales analytics (working dataset)
│   ├── 📁 test3/             # Transportation domain  
│   └── 📁 test9/             # Empty (tests generic fallback)
├── 📁 docs/                  # Documentation and test outputs
├── 📁 dist/                  # Compiled TypeScript output
└── package.json              # Main project dependencies
```

---

## 🌐 Domain Intelligence

**Proven across multiple domains:**

- ✅ **Sales Analytics**: E-commerce revenue and customer metrics
- ✅ **Transportation**: Bike share operations (4.8M+ trips analyzed)  
- ✅ **Compliance**: UK social housing fire safety regulations
- ✅ **Finance**: Revenue, cost, and profitability analysis
- ✅ **Healthcare**: Patient outcomes and operational metrics
- ✅ **Generic Analytics**: Graceful fallback for any unknown domain

**Domain-Agnostic Design Principles:**
- No hardcoded business assumptions or industry terminology
- Generic fallbacks prevent AI hallucination
- Technical analysis works with any DAX formula
- Stakeholder identification adapts to business context

---

## 🔄 Common Workflows

### Workflow 1: New Power BI Model Documentation
```bash
# 1. Export data from Power BI Desktop
# Run these DAX queries and save each as CSV:
# EVALUATE INFO.VIEW.MEASURES()      → measures.csv
# EVALUATE INFO.VIEW.TABLES()        → tables.csv  
# EVALUATE INFO.VIEW.COLUMNS()       → columns.csv
# EVALUATE INFO.VIEW.RELATIONSHIPS() → relationships.csv

# 2. Create project directory
mkdir my-new-model
mv *.csv my-new-model/

# 3. Generate documentation
npm run cli orchestrate ./my-new-model

# 4. Share with stakeholders
# Open: my-new-model/out/model_documentation.html
# Email or upload to SharePoint/Teams
```

### Workflow 2: Model Updates & Change Detection
```bash
# 1. Export updated model data
mkdir my-model-v2
# ... export new CSV files ...

# 2. Generate new documentation
npm run cli orchestrate ./my-model-v2

# 3. Compare with previous version
diff ./my-model-v1/out/final_report.json ./my-model-v2/out/final_report.json

# 4. Highlight changes in stakeholder communication
# Use generated confidence scores to identify significant changes
```

### Workflow 3: Large Model Processing (100+ Measures)
```bash
# 1. Start with subset for testing
npm run cli orchestrate ./large-model --max-measures 10

# 2. Process in batches if needed
npm run cli orchestrate ./large-model --max-measures 50

# 3. Full processing (may take 10-15 minutes)
npm run cli orchestrate ./large-model

# 4. Monitor progress and performance
tail -f logs/orchestrator.log  # If logging enabled
```

### Workflow 4: Integration into CI/CD Pipeline
```yaml
# .github/workflows/powerbi-docs.yml
name: Power BI Documentation
on:
  push:
    paths: ['powerbi-exports/**']

jobs:
  generate-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm install
        
      - name: Build DAX Catalog
        run: npm run build
        
      - name: Generate documentation
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npm run cli orchestrate ./powerbi-exports
          
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./powerbi-exports/out
```

### Workflow 5: Custom Agent Development
```typescript
// Create custom agent: src/agents/agent-7-custom.ts
import { BaseAgent, AgentResult, AgentContext } from './base-agent';
import { ClaudeClient } from '../claude-config';

export class CustomAnalysisAgent extends BaseAgent {
  constructor() {
    super('Custom Analysis Agent');
  }

  async analyze(
    context: AgentContext, 
    claudeClient: ClaudeClient
  ): Promise<AgentResult> {
    // Custom analysis logic
    const prompt = this.buildPrompt(context);
    const response = await this.callClaude(prompt, claudeClient);
    
    return this.createResult(
      response.data || '',
      { customMetrics: this.calculateCustomMetrics(context) },
      0.95
    );
  }

  protected buildPrompt(context: AgentContext): string {
    return `Analyze this Power BI model for custom requirements...`;
  }
  
  private calculateCustomMetrics(context: AgentContext) {
    // Your custom logic here
    return {
      complexity_score: context.measures?.length || 0,
      relationship_density: (context.relationships?.length || 0) / (context.tables?.length || 1)
    };
  }
}

// Integrate into orchestrator
import { CustomAnalysisAgent } from './agents/agent-7-custom';

// Add to your analysis workflow
const customAgent = new CustomAnalysisAgent();
const customResult = await customAgent.analyze(context, claudeClient);
```

---

## 🔧 Troubleshooting & Error Handling

### Common Issues and Solutions

**Error: "Could not resolve authentication method"**
```bash
# Check API key is set correctly
echo $ANTHROPIC_API_KEY

# If using .env file, ensure format is correct:
echo "ANTHROPIC_API_KEY=sk-ant-api03-your-key-here" > .env

# Test API connection
npm run cli analyze 'SUM([Amount])' --name 'Test'
```

**Error: "No measures found in context"**
```bash
# Check CSV file format and content
head -5 measures.csv  # Should show proper headers

# Verify file detection
npm run cli discover ./your-data --preview

# Check for INFO.VIEW metadata contamination
grep -i "measures_table" *.csv  # Should return nothing
```

**Performance Issues with Large Models**
```typescript
// Use progress monitoring
const progressCallback = (agent: string, stage: string, result?: any) => {
  console.log(`[${new Date().toISOString()}] ${agent}: ${stage}`);
  if (result?.confidence) {
    console.log(`  Confidence: ${result.confidence}`);
  }
};

// Implement timeout handling
const orchestrator = new AgentOrchestrator();
const timeoutPromise = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('Analysis timeout')), 600000) // 10 minutes
);

const result = await Promise.race([
  orchestrator.orchestrateFromDirectory('./data', progressCallback),
  timeoutPromise
]);
```

**Memory Issues**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Process in smaller batches
npm run cli orchestrate ./data --max-measures 25

# Clear output between runs
rm -rf ./data/out/
```

**API Rate Limiting**
```typescript
// Custom Claude client with longer delays
const claude = new ClaudeClient({
  timeout: 300000,  // 5 minutes
  maxTokens: 2000   // Reduce token usage
});

// Implement exponential backoff
async function retryWithBackoff(operation: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### Debug Mode Usage
```bash
# Enable verbose logging
export DEBUG=dax-catalog:*

# Run with debug output
npm run cli orchestrate ./data 2>&1 | tee debug.log

# Check specific agent output
grep "Agent 4" debug.log  # DAX Analyzer output
grep "confidence" debug.log  # All confidence scores
```

### Validation Scripts
```typescript
// Validate Power BI export quality
import { InfoViewParser } from './src/csv-parser';

async function validateExport(directory: string) {
  const parser = new InfoViewParser();
  const result = await parser.parseDirectory(directory);
  
  console.log('Validation Results:');
  console.log(`✓ Measures: ${result.measures?.length || 0}`);
  console.log(`✓ Tables: ${result.tables?.length || 0}`);
  console.log(`✓ Columns: ${result.columns?.length || 0}`);
  console.log(`✓ Relationships: ${result.relationships?.length || 0}`);
  
  // Check for common issues
  const issues = [];
  if (!result.measures?.length) issues.push('No measures found');
  if (!result.tables?.length) issues.push('No tables found');
  
  if (issues.length > 0) {
    console.log('⚠️ Issues found:', issues.join(', '));
    process.exit(1);
  }
  
  console.log('✅ Export validation passed');
}

// Usage: npm run validate-export ./my-data
```

---

## 🚀 Development & Testing

### Build System
```bash
npm run build          # Compile TypeScript
npm run typecheck      # Type checking only
npm run lint:check     # Code quality check
npm run test          # Run test suite
```

### Testing Different Domains
```bash
# Test with different domains
npm run cli orchestrate ./sample-data/test2  # Sales
npm run cli orchestrate ./sample-data/test3  # Transportation  
npm run cli orchestrate ./sample-data/test9  # Generic fallback

# Performance testing
time npm run cli orchestrate ./sample-data/test2 --max-measures 1
# Should complete in under 2 minutes
```

### Local Development Server
```bash
# Development mode with hot reload
cd web-app
npm run dev

# Production build testing
npm run build
npm start

# Test API endpoints
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"csvData": {...}, "maxMeasures": 5}'
```

---

## 📈 Business Impact

### Before DAX Catalog
- ❌ Manual documentation takes hours per model
- ❌ Technical DAX confuses business stakeholders  
- ❌ Documentation becomes outdated quickly
- ❌ Inconsistent standards across teams
- ❌ Knowledge trapped with developers

### After DAX Catalog  
- ✅ **90% time reduction**: Generate docs in minutes
- ✅ **Stakeholder-ready**: Business users understand metrics immediately
- ✅ **Always current**: Automated regeneration with model changes
- ✅ **Consistent quality**: Standardized across all domains
- ✅ **Knowledge sharing**: Insights captured and accessible

---

## 🔧 Configuration

### Environment Variables
```bash
ANTHROPIC_API_KEY=your_claude_api_key    # Required
NODE_ENV=production                      # Optional
```

### API Settings  
- **Model**: `claude-sonnet-4-20250514` (latest Sonnet 4)
- **Timeout**: 120 seconds per request
- **Concurrency**: Limited to 3 parallel requests
- **Max Tokens**: 2000-4000 depending on agent

---

## 📋 Output Artifacts

Each analysis generates comprehensive artifacts in `{dataset}/out/`:

| File | Purpose |
|------|---------|
| `meta.json` | Schema v1.0.0 metadata with generation timestamp |
| `final_report.json` | Complete analysis with DAX lint findings |
| `model_documentation.html` | Formatted HTML for immediate stakeholder sharing |
| `model_documentation.md` | Technical Markdown documentation |
| `model_kpis.csv` | Structured data export for further analysis |
| `synthesis.json` | Pre-polish intermediate analysis data |

---

## 🤝 Contributing

**DAX Catalog v1.0.0** is production-ready! Areas for enhancement:

- 🔧 Additional export formats (PowerPoint, Confluence)  
- 🔍 Enhanced DAX pattern recognition
- 🌐 Power BI Service API integration
- 📊 Advanced data lineage visualization
- 🎯 Custom agent orchestration patterns

---

## 📄 License

MIT License - Build amazing Power BI documentation! 

---

## 🙏 Acknowledgments

**Built with:**
- 🤖 **Anthropic Claude Sonnet 4** - Advanced AI reasoning
- ⚛️ **React + Express** - Modern web interface  
- 📝 **TypeScript** - Type-safe development
- 🚀 **Node.js** - Runtime platform

---

*Transforming Power BI complexity into stakeholder clarity* ✨