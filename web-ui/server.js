#!/usr/bin/env node
// Minimal web UI server for AgentOrchestrator with SSE progress

const path = require('path');
// Load .env explicitly from web-ui folder to avoid cwd ambiguity
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const fsp = require('fs/promises');
const express = require('express');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const cors = require('cors');

const app = express();
const PORT = process.env.UI_PORT || 5001;
console.log(`[env] ANTHROPIC_API_KEY present: ${process.env.ANTHROPIC_API_KEY ? 'yes' : 'no'}`);
if (process.env.CLAUDE_MODEL) console.log(`[env] CLAUDE_MODEL: ${process.env.CLAUDE_MODEL}`);

// Try to load orchestrator from compiled dist, else from TS using ts-node
let AgentOrchestrator;
(function loadOrchestrator() {
  try {
    AgentOrchestrator = require('../dist/agent-orchestrator').AgentOrchestrator;
    console.log('Loaded AgentOrchestrator from dist');
    return;
  } catch (e1) {
    try {
      // Try standard ts-node register first; fall back to transpile-only
      try { require('ts-node/register'); } catch { require('ts-node/register/transpile-only'); }
      AgentOrchestrator = require('../src/agent-orchestrator').AgentOrchestrator;
      console.log('Loaded AgentOrchestrator from src via ts-node');
      return;
    } catch (e2) {
      console.error('Failed to load AgentOrchestrator. Build project (root: npm run build) or install dev deps in web-ui (ts-node, typescript).');
      console.error('Errors:', e1?.message, e2?.message);
      process.exit(1);
    }
  }
})();

// Storage for runs and SSE clients
const runsRoot = path.join(process.cwd(), 'runs');
const tmpRoot = path.join(process.cwd(), 'tmp-uploads');
const jobs = new Map(); // id -> { dir, status, startedAt, finishedAt, artifacts, memory?, ttlTimer? }
const sseClients = new Map(); // id -> Set(res)
const EPHEMERAL_TTL_MS = parseInt(process.env.EPHEMERAL_TTL_MS || '', 10) || 10 * 60 * 1000; // 10 minutes

// Ensure runs root exists
fs.mkdirSync(runsRoot, { recursive: true });
fs.mkdirSync(tmpRoot, { recursive: true });

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer config for CSVs
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tmpRoot),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per file
  fileFilter: (req, file, cb) => {
    if (/\.csv$/i.test(file.originalname)) return cb(null, true);
    cb(new Error('Only CSV files allowed'));
  }
});

// Utilities
function newId() {
  try { if (typeof randomUUID === 'function') return randomUUID(); } catch {}
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function sendSse(id, data) {
  const set = sseClients.get(id);
  if (!set) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* client likely disconnected */ }
  }
}

async function listArtifacts(runDir) {
  const outDir = path.join(runDir, 'out');
  try {
    const names = await fsp.readdir(outDir);
    return names.filter(n => /^(final_report\.json|synthesis\.json|model_documentation\.(html|md)|model_kpis\.csv|meta\.json)$/.test(n));
  } catch { return []; }
}

async function loadArtifactsToMemory(id) {
  const job = jobs.get(id);
  if (!job) return { names: [] };
  const names = await listArtifacts(job.dir);
  const files = new Map();
  for (const name of names) {
    const p = path.join(job.dir, 'out', name);
    try {
      const buf = await fsp.readFile(p);
      const ext = path.extname(name).toLowerCase();
      const type = ext === '.html' ? 'text/html'
        : ext === '.md' ? 'text/markdown'
        : ext === '.json' ? 'application/json'
        : ext === '.csv' ? 'text/csv'
        : 'application/octet-stream';
      files.set(name, { buffer: buf, type });
    } catch {
      // ignore single file failures
    }
  }
  job.memory = { files, names };
  job.artifacts = names;
  return { names };
}

function scheduleCleanup(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.ttlTimer) clearTimeout(job.ttlTimer);
  job.ttlTimer = setTimeout(async () => {
    try {
      const j = jobs.get(id);
      if (!j) return;
      if (j.dir) {
        await fsp.rm(j.dir, { recursive: true, force: true });
      }
      if (j.memory) {
        j.memory.files.clear();
      }
      jobs.delete(id);
      sseClients.delete(id);
      console.log(`🧹 Cleaned ephemeral job ${id}`);
    } catch (err) {
      console.error('Cleanup error', err);
    }
  }, EPHEMERAL_TTL_MS);
}

// Routes
app.get('/api/health', (req, res) => res.json({ ok: true }));

// SSE progress stream
app.get('/api/progress/:id', (req, res) => {
  const { id } = req.params;
  console.log(`[api] SSE connect for ${id}`);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let set = sseClients.get(id);
  if (!set) { set = new Set(); sseClients.set(id, set); }
  set.add(res);

  // Send initial status if known
  if (jobs.has(id)) {
    res.write(`data: ${JSON.stringify({ type: 'status', status: jobs.get(id).status })}\n\n`);
  }

  req.on('close', () => {
    console.log(`[api] SSE disconnect for ${id}`);
    set.delete(res);
    if (set.size === 0) sseClients.delete(id);
  });
});

// Start analysis (accept any subset of CSVs)
app.post('/api/analyze', upload.fields([
  { name: 'measures', maxCount: 1 },
  { name: 'tables', maxCount: 1 },
  { name: 'columns', maxCount: 1 },
  { name: 'relationships', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('📤 /api/analyze received');
    const id = newId();
    const runDir = path.join(runsRoot, id);
    await fsp.mkdir(runDir, { recursive: true });
    console.log(`[job ${id}] runDir: ${runDir}`);

    // Move any provided files into runDir with canonical names
    const provided = req.files || {};
    console.log(`[job ${id}] files: ${Object.keys(provided||{}).join(', ') || '(none)'}`);
    const mapping = [ 'measures', 'tables', 'columns', 'relationships' ];
    for (const key of mapping) {
      const fileArr = provided[key];
      if (Array.isArray(fileArr) && fileArr[0]) {
        const src = fileArr[0].path;
        const dst = path.join(runDir, `${key}.csv`);
        await fsp.rename(src, dst);
        console.log(`[job ${id}] moved ${key} -> ${dst}`);
      }
    }

    jobs.set(id, { id, dir: runDir, status: 'queued', startedAt: new Date().toISOString(), finishedAt: null, artifacts: [] });
    // Immediately mark as running to avoid UI stuck on 'Queued' if SSE is delayed
    const job = jobs.get(id);
    job.status = 'running';
    sendSse(id, { type: 'status', status: 'running' });
    console.log(`[job ${id}] status: running`);

    // Kick off orchestration async
    setImmediate(() => runOrchestration(id).catch(err => {
      console.error('Run failed:', err);
    }));

    res.json({ analysisId: id, status: 'queued' });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'Failed to start analysis' });
  }
});

// Get final result metadata and artifact list
app.get('/api/result/:id', async (req, res) => {
  const { id } = req.params;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: 'Unknown analysis id' });
  const artifacts = job.memory?.names || (job.dir ? await listArtifacts(job.dir) : []);
  scheduleCleanup(id);
  console.log(`[job ${id}] status query → ${job.status}; artifacts: ${artifacts.length}`);
  res.json({ id, status: job.status, artifacts });
});

// Download artifact
app.get('/api/download/:id/:name', (req, res) => {
  const { id, name } = req.params;
  const job = jobs.get(id);
  if (!job) return res.status(404).send('Unknown analysis id');
  const mem = job.memory?.files?.get(name);
  if (mem) {
    scheduleCleanup(id);
    res.setHeader('Content-Type', mem.type);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.send(mem.buffer);
  }
  const filePath = job.dir ? path.join(job.dir, 'out', name) : null;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('File not found');
  scheduleCleanup(id);
  res.download(filePath);
});

// Serve artifact inline with appropriate content type (for in-page viewing)
app.get('/api/artifact/:id/:name', (req, res) => {
  const { id, name } = req.params;
  const job = jobs.get(id);
  if (!job) return res.status(404).send('Unknown analysis id');
  const mem = job.memory?.files?.get(name);
  if (mem) {
    scheduleCleanup(id);
    res.type(mem.type);
    return res.send(mem.buffer);
  }
  const filePath = job.dir ? path.join(job.dir, 'out', name) : null;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('File not found');
  const ext = path.extname(name).toLowerCase();
  if (ext === '.html') res.type('html');
  else if (ext === '.md' || ext === '.markdown') res.type('text/markdown');
  else if (ext === '.json') res.type('application/json');
  else if (ext === '.csv') res.type('text/csv');
  scheduleCleanup(id);
  return res.sendFile(filePath);
});

// Orchestration runner with progress wiring
async function runOrchestration(id) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'running';
  sendSse(id, { type: 'status', status: 'running' });

  const orchestrator = new AgentOrchestrator();

  const progress = (agentType, stage) => {
    console.log(`[job ${id}] ${agentType}: ${stage}`);
    sendSse(id, { type: 'progress', agent: agentType, stage, ts: Date.now() });
  };

  try {
    const result = await orchestrator.orchestrateFromDirectory(job.dir, progress, 'all');
    const { names } = await loadArtifactsToMemory(id);
    try { await fsp.rm(job.dir, { recursive: true, force: true }); } catch {}
    job.dir = null;
    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    job.artifacts = names;
    sendSse(id, { type: 'done', artifacts: names });
    console.log(`[job ${id}] completed; artifacts in memory: ${names.length}`);
    scheduleCleanup(id);
  } catch (err) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    sendSse(id, { type: 'error', message: String(err?.message || err) });
    console.error(`[job ${id}] failed:`, err);
    scheduleCleanup(id);
  }
}

app.listen(PORT, () => {
  console.log(`Orchestrator UI running on http://localhost:${PORT}`);
});
