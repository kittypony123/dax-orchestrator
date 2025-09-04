const form = document.getElementById('analyze-form');
const dropzone = document.getElementById('dropzone');
const dzTags = document.getElementById('dz-tags');
const browseBtn = document.getElementById('browse-btn');
const filePicker = document.getElementById('file-picker');
const progressCard = document.getElementById('progress-card');
const resultsCard = document.getElementById('results-card');
const statusEl = document.getElementById('status');
const statusPill = document.getElementById('status-pill');
const eventsEl = document.getElementById('events');
const artifactsEl = document.getElementById('artifacts');
const reportCard = document.getElementById('report-card');
const reportActions = document.getElementById('report-actions');
const openReport = document.getElementById('open-report');
const reportFrameWrap = document.getElementById('report-frame-wrap');
const reportFrame = document.getElementById('report-frame');
const reportHtml = document.getElementById('report-html');
const themeToggle = document.getElementById('theme-toggle');
const toasts = document.getElementById('toasts');

let source = null;
let pollTimer = null;

// Init Lucide icons when available
document.addEventListener('DOMContentLoaded', () => {
  try { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); } catch {}
});

// Simple “selected files” registry for dropzone
const selected = { measures:null, tables:null, columns:null, relationships:null };

function classifyCsv(name){
  const n = (name||'').toLowerCase();
  if (/(measure|measures)/.test(n)) return 'measures';
  if (/(table|tables)/.test(n)) return 'tables';
  if (/(column|columns)/.test(n)) return 'columns';
  if (/(relation|relationships)/.test(n)) return 'relationships';
  return null;
}

function addSelected(files){
  for (const f of files){
    const slot = classifyCsv(f.name);
    if (slot) selected[slot] = f;
  }
  renderDzTags();
}

function renderDzTags(){
  const frag = document.createDocumentFragment();
  Object.entries(selected).forEach(([slot,file])=>{
    if (file){
      const span = document.createElement('span');
      span.className = 'chip';
      span.textContent = `${slot}: ${file.name}`;
      frag.appendChild(span);
    }
  });
  dzTags.innerHTML='';
  dzTags.appendChild(frag);
}

dropzone?.addEventListener('dragover', (e)=>{ e.preventDefault(); dropzone.classList.add('drag'); });
dropzone?.addEventListener('dragleave', ()=> dropzone.classList.remove('drag'));
dropzone?.addEventListener('drop', (e)=>{
  e.preventDefault();
  dropzone.classList.remove('drag');
  const files = Array.from(e.dataTransfer.files||[]).filter(f=>/\.csv$/i.test(f.name));
  if (files.length){ addSelected(files); showToast(`Added ${files.length} file(s)`, 'info'); }
});

browseBtn?.addEventListener('click', ()=> filePicker?.click());
filePicker?.addEventListener('change', ()=>{
  const files = Array.from(filePicker.files||[]);
  if (files.length){ addSelected(files); filePicker.value=''; }
});

// Theme handling
const PREF_KEY = 'theme-preference';
const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const savedTheme = localStorage.getItem(PREF_KEY);
applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));

themeToggle?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(PREF_KEY, next); } catch {}
  showToast(`${next.charAt(0).toUpperCase()+next.slice(1)} theme`, 'info');
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = theme === 'dark' ? '🌙' : '☀️';
  const btn = document.querySelector('#theme-toggle .icon');
  if (btn) btn.textContent = icon;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  eventsEl.innerHTML = '';
  artifactsEl.innerHTML = '';
  resultsCard.hidden = true;
  progressCard.hidden = false;
  setStatus('Starting…');
  if (statusPill){ statusPill.textContent='Starting'; statusPill.classList.remove('success','error'); }

  // Build FormData from dropzone selection first, then fall back to fields
  const data = new FormData();
  const slots = ['measures','tables','columns','relationships'];
  for (const s of slots){
    if (selected[s]) data.append(s, selected[s]);
  }
  if (![...data.keys()].length){
    // No dropzone files; fall back to form inputs
    const fallback = new FormData(form);
    for (const [k,v] of fallback.entries()) data.append(k,v);
  }

  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: data });
    if (!res.ok) throw new Error('Failed to start analysis');
    const { analysisId } = await res.json();
    setStatus('Running');
    if (statusPill){ statusPill.textContent='Running'; }
    showToast('Uploading complete. Analysis starting…', 'info');
    streamProgress(analysisId);
  } catch (err) {
    setStatus('Error');
    showToast(`Error: ${err.message}`, 'error');
    if (statusPill){ statusPill.textContent='Error'; statusPill.classList.add('error'); }
  }
});

function streamProgress(id) {
  if (source) source.close();
  source = new EventSource(`/api/progress/${id}`);

  // Fallback polling in case SSE is blocked
  startStatusPoll(id);

  source.onopen = () => {
    // SSE connected; keep poll as a safety net
  };

  source.onmessage = (evt) => {
    const payload = JSON.parse(evt.data || '{}');
    if (payload.type === 'status') {
      setStatus(payload.status);
      if (payload.status === 'running') showToast('Analysis started', 'info');
      if (statusPill){ statusPill.textContent = payload.status.charAt(0).toUpperCase()+payload.status.slice(1); }
    } else if (payload.type === 'progress') {
      const li = document.createElement('li');
      li.textContent = `${payload.agent}: ${payload.stage}`;
      eventsEl.appendChild(li);
    } else if (payload.type === 'done') {
      setStatus('Completed');
      source.close();
      showToast('Analysis complete', 'success');
      if (statusPill){ statusPill.textContent='Completed'; statusPill.classList.add('success'); }
      stopStatusPoll();
      loadArtifacts(id);
    } else if (payload.type === 'error') {
      setStatus('Failed');
      source.close();
      showToast(`Analysis failed: ${payload.message}`, 'error');
      if (statusPill){ statusPill.textContent='Failed'; statusPill.classList.add('error'); }
      stopStatusPoll();
    }
  };

  source.onerror = () => {
    // Connection error; keep UI as-is. Server will complete anyway.
  };
}

function startStatusPoll(id){
  stopStatusPoll();
  pollTimer = setInterval(async () => {
    try{
      const res = await fetch(`/api/result/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.status) return;
      const st = String(data.status).toLowerCase();
      if (st === 'running' && statusPill) statusPill.textContent = 'Running';
      if (st === 'completed'){
        if (statusPill) { statusPill.textContent = 'Completed'; statusPill.classList.add('success'); }
        stopStatusPoll();
        loadArtifacts(id);
      }
      if (st === 'failed'){
        if (statusPill) { statusPill.textContent = 'Failed'; statusPill.classList.add('error'); }
        stopStatusPoll();
      }
    }catch{}
  }, 2000);
}

function stopStatusPoll(){
  if (pollTimer){ clearInterval(pollTimer); pollTimer = null; }
}

async function loadArtifacts(id) {
  try {
    const res = await fetch(`/api/result/${id}`);
    const data = await res.json();
    const files = data.artifacts || [];
    if (!files.length) {
      artifactsEl.innerHTML = '<p>No artifacts produced.</p>';
    } else {
      const frag = document.createDocumentFragment();
      files.forEach(name => {
        const a = document.createElement('a');
        a.href = `/api/download/${id}/${encodeURIComponent(name)}`;
        a.textContent = `Download ${name}`;
        a.className = 'download';
        a.setAttribute('download', name);
        frag.appendChild(a);
      });
      artifactsEl.innerHTML = '';
      artifactsEl.appendChild(frag);
    }
    resultsCard.hidden = false;

    // Show full report if available
    await showReport(id, files);
  } catch (err) {
    artifactsEl.innerHTML = `<p>Error loading artifacts: ${err.message}</p>`;
    resultsCard.hidden = false;
  }
}

async function showReport(id, files) {
  reportCard.hidden = false;
  // Prefer HTML artifact; fallback to rendering JSON
  const htmlName = files.find(n => n.toLowerCase() === 'model_documentation.html');
  if (htmlName) {
    const url = `/api/artifact/${id}/${encodeURIComponent(htmlName)}`;
    openReport.href = url;
    reportActions.hidden = false;
    const skeleton = document.getElementById('frame-skeleton');
    if (skeleton) skeleton.style.display = 'block';
    reportFrame.src = url;
    reportFrame.onload = ()=>{ if (skeleton) skeleton.style.display = 'none'; };
    reportHtml.hidden = true;
    reportFrameWrap.hidden = false;
    return;
  }

  const jsonName = files.find(n => n.toLowerCase() === 'final_report.json');
  if (jsonName) {
    const url = `/api/artifact/${id}/${encodeURIComponent(jsonName)}`;
    try {
      const res = await fetch(url);
      const obj = await res.json();
      renderJsonReport(obj);
      attachCopyButtons(reportHtml);
      reportActions.hidden = true;
      reportFrameWrap.hidden = true;
      reportHtml.hidden = false;
      return;
    } catch (e) {
      reportHtml.innerHTML = `<p>Could not load report JSON.</p>`;
      reportActions.hidden = true;
      reportFrameWrap.hidden = true;
      reportHtml.hidden = false;
      return;
    }
  }

  reportHtml.innerHTML = '<p>No viewable report artifact was produced.</p>';
  reportActions.hidden = true;
  reportFrameWrap.hidden = true;
  reportHtml.hidden = false;
}

function renderJsonReport(data) {
  const safe = (v, fallback = '') => typeof v === 'string' && v.trim() ? v : fallback;
  const measures = Array.isArray(data.measures) ? data.measures : [];
  const tables = Array.isArray(data.tables) ? data.tables : [];
  const relationships = Array.isArray(data.relationships) ? data.relationships : [];
  const overview = data.overview || {};
  const business = data.businessUserGuidance || {};
  const exec = data.executiveInsights || {};
  const roadmap = data.improvementRoadmap || {};

  const parts = [];

  // Header / Overview
  parts.push(`
    <div class="report-hero">
      <div>
        <h3>${safe(overview.title || data.domain || 'Model Documentation', 'Model Documentation')}</h3>
        <p class="muted">${safe(overview.summary || overview.description || '', '')}</p>
      </div>
      <div class="stats">
        <div><span>${String(tables.length)}</span><label>Tables</label></div>
        <div><span>${String(measures.length)}</span><label>Measures</label></div>
        <div><span>${String(relationships.length)}</span><label>Relationships</label></div>
      </div>
    </div>
  `);

  // Executive Insights
  if (exec && (exec.keyTakeaways || exec.summary || exec.risks)) {
    const bullets = [].concat(exec.keyTakeaways || [], exec.risks || []).slice(0, 6)
      .map(t => `<li>${t}</li>`).join('');
    parts.push(`
      <section>
        <h4>Executive Insights</h4>
        <p class="muted">${safe(exec.summary || '', '')}</p>
        ${bullets ? `<ul class="bullets">${bullets}</ul>` : ''}
      </section>
    `);
  }

  // Business Guidance - Removed card display, measures will show in table only

  // Measures Table (rows) - Enhanced display
  if (measures.length) {
    const rows = measures.slice(0, 200).map((m, index) => {
      const name = safe(m.name || m.measureName || 'Measure');
      const desc = safe(m.businessMeaning || m.description || m.purpose || '', '');
      const folder = safe(m.folder || m.displayFolder || '', '');
      const dax = safe(m.dax || m.formula || m.expression || '', '');
      const dataType = safe(m.dataType || '', '');
      const isVisible = m.isHidden === false || m.isHidden === undefined ? 'Visible' : 'Hidden';
      
      return `
        <tr class="measure-row">
          <td class="cell-index">${index + 1}</td>
          <td class="cell-name">
            <div class="measure-name">${name}</div>
            ${dataType ? `<small class="data-type">${dataType}</small>` : ''}
          </td>
          <td class="cell-folder">${folder ? `<span class="badge">${folder}</span>` : '<span class="muted">No folder</span>'}</td>
          <td class="cell-desc">
            <div class="description">${desc || '<span class="muted">No description</span>'}</div>
          </td>
          <td class="cell-dax">
            ${dax ? `<div class="dax-container"><pre class="code language-dax"><code class="language-dax">${escapeHtml(dax)}</code></pre></div>` : '<span class="muted">No formula</span>'}
          </td>
          <td class="cell-visibility">
            <span class="badge ${isVisible === 'Visible' ? 'success' : 'warn'}">${isVisible}</span>
          </td>
        </tr>
      `;
    }).join('');

    parts.push(`
      <section class="measures-section">
        <div class="section-header">
          <h4>DAX Measures (${measures.length} total)</h4>
          <p class="muted">All measures displayed in table format with complete details</p>
        </div>
        <div class="table-wrap measures-table-wrap">
          <table class="table measures-table">
            <thead>
              <tr>
                <th style="width:4%">#</th>
                <th style="width:20%">Measure Name</th>
                <th style="width:12%">Folder</th>
                <th style="width:25%">Business Description</th>
                <th style="width:32%">DAX Formula</th>
                <th style="width:7%">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </section>
    `);
  }

  // Tables summary
  if (tables.length) {
    const chips = tables.slice(0, 40).map(t => `<span class="chip">${escapeHtml(t.name || '')}</span>`).join('');
    parts.push(`
      <section>
        <h4>Tables</h4>
        <div class="chips">${chips}</div>
      </section>
    `);
  }

  reportHtml.innerHTML = parts.join('\n');
  if (window.Prism) Prism.highlightAllUnder(reportHtml);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

function attachCopyButtons(container) {
  const pres = container.querySelectorAll('pre.code');
  pres.forEach(pre => {
    const wrap = document.createElement('div');
    wrap.className = 'code-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.innerHTML = '<span>Copy</span>';
    btn.addEventListener('click', async () => {
      try {
        const text = pre.textContent || '';
        await navigator.clipboard.writeText(text);
        flashCopied(btn);
        showToast('Copied code to clipboard', 'success');
      } catch {}
    });
    wrap.appendChild(btn);
  });
}

function flashCopied(btn) {
  btn.classList.add('copied');
  const old = btn.innerHTML;
  btn.innerHTML = '<span>Copied ✓</span>';
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = old;
  }, 1200);
}

// Toasts
function showToast(message, type = 'info') {
  if (!toasts) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="msg">${escapeHtml(message)}</span>`;
  toasts.appendChild(el);
  // Auto remove
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 250);
  }, 3200);
}
// Helper: update status text safely (supports legacy #status and new #status-pill)
function setStatus(text) {
  const t = String(text ?? '').trim();
  if (statusEl) statusEl.textContent = t;
  if (statusPill) statusPill.textContent = t.charAt(0).toUpperCase() + t.slice(1);
}
