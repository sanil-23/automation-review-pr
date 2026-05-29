// In-process cron scheduler — runs the 3 reviewer crons inside the dashboard
// server so the whole thing is ONE app (no separate OS crontab needed). Reads
// cron-config.json every tick, so edits from the dashboard take effect live.
//
// Each script already holds a flock, so this is safe even if an OS crontab is
// also installed (duplicate fires are deduped to a no-op).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(process.cwd(), '..');
const CFG = path.join(BASE_DIR, 'cron-config.json');
const LOGS = path.join(BASE_DIR, 'logs');

const JOBS = [
  { name: 'scout',  cfgKey: 'scout',  script: 'bin/scout-assign', log: 'cron-scout.log',  def: '*/20 * * * *' },
  { name: 'review', cfgKey: 'review', script: 'bin/review-cron',   log: 'cron-review.log', def: '*/30 * * * *' },
  { name: 'stall',  cfgKey: 'stall',  script: 'bin/stall-watch',   log: 'cron-stall.log',  def: '0 * * * *' },
];

// Per-job runtime state (singleton across HMR).
const KEY = '__reviewer_scheduler__';
if (!globalThis[KEY]) {
  globalThis[KEY] = {
    timer: null,
    state: Object.fromEntries(JOBS.map((j) => [j.name, {
      running: false, pid: null, lastRun: null, lastExit: null, lastFiredMinute: null,
    }])),
  };
}
const S = globalThis[KEY];

// --- 5-field cron matcher (*, */n, a-b, a,b, n) in local time -----------------
function fieldMatch(field, value, min, max) {
  if (field === '*') return true;
  for (const part of String(field).split(',')) {
    let step = 1, range = part;
    if (part.includes('/')) { const [r, s] = part.split('/'); range = r || '*'; step = parseInt(s, 10) || 1; }
    let lo, hi;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) { const [a, b] = range.split('-'); lo = +a; hi = +b; }
    else { lo = hi = +range; }
    for (let v = lo; v <= hi; v += step) if (v === value) return true;
  }
  return false;
}
function cronMatch(expr, d) {
  const p = String(expr).trim().split(/\s+/);
  if (p.length !== 5) return false;
  return fieldMatch(p[0], d.getMinutes(), 0, 59)
    && fieldMatch(p[1], d.getHours(), 0, 23)
    && fieldMatch(p[2], d.getDate(), 1, 31)
    && fieldMatch(p[3], d.getMonth() + 1, 1, 12)
    && fieldMatch(p[4], d.getDay(), 0, 6);
}

function readCfg() {
  try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); }
  catch { return { enabled: true, scout: '*/20 * * * *', review: '*/30 * * * *', stall: '0 * * * *' }; }
}

function runJob(job, reason = 'schedule') {
  const st = S.state[job.name];
  if (st.running) { console.log(`[sched] ${job.name} still running — skip`); return false; }
  fs.mkdirSync(LOGS, { recursive: true });
  const out = fs.openSync(path.join(LOGS, job.log), 'a');
  const child = spawn('bash', [path.join(BASE_DIR, job.script)], {
    cwd: BASE_DIR, env: { ...process.env }, stdio: ['ignore', out, out], detached: false,
  });
  st.running = true; st.pid = child.pid; st.lastRun = new Date().toISOString();
  console.log(`[sched] ▶ ${job.name} (${reason}) pid ${child.pid}`);
  child.on('exit', (code) => {
    st.running = false; st.pid = null; st.lastExit = code;
    try { fs.closeSync(out); } catch {}
    console.log(`[sched] ■ ${job.name} exit ${code}`);
  });
  return true;
}

function tick() {
  const cfg = readCfg();
  if (cfg.enabled === false) return;
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  for (const job of JOBS) {
    const expr = cfg[job.cfgKey] || job.def;
    const st = S.state[job.name];
    if (st.lastFiredMinute === minuteKey) continue; // already evaluated this minute
    if (cronMatch(expr, now)) { st.lastFiredMinute = minuteKey; runJob(job); }
  }
}

function start() {
  if (S.timer) return; // already scheduling
  console.log('[sched] in-process scheduler started (reads cron-config.json)');
  tick();
  S.timer = setInterval(tick, 60 * 1000);
}

function getState() {
  return { config: readCfg(), jobs: S.state, active: !!S.timer };
}

// Fire a job immediately (dashboard "Run now"). name in scout|review|stall.
function runNow(name) {
  const job = JOBS.find((j) => j.name === name);
  if (!job) return false;
  return runJob(job, 'manual');
}

module.exports = { start, getState, runNow, cronMatch, JOBS };
