// Ingests the FSM store (repo-root state/pr-<N>.json, written by the cron
// scripts) into the pr_state table. Mirrors sync.js: an initial full pass plus
// a debounced fs.watch. process.cwd() is dashboard-next/; the store is one
// level up.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const STATE_DIR = path.join(path.resolve(process.cwd(), '..'), 'state');
const DEBOUNCE_MS = 400;
const timers = new Map();

function ingestFile(file) {
  if (!/^pr-\d+\.json$/.test(path.basename(file))) return;
  const full = path.join(STATE_DIR, path.basename(file));
  try {
    const raw = fs.readFileSync(full, 'utf8');
    const s = JSON.parse(raw);
    if (!s || !s.pr) return;
    db.upsertPrState(s);
  } catch (e) {
    // Partial write mid-flush — the watch will fire again on completion.
    if (e.code !== 'ENOENT') console.error('[state-sync] parse', file, e.message);
  }
}

function ingestAll() {
  let n = 0; const ids = [];
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      const m = f.match(/^pr-(\d+)\.json$/);
      if (m) { ingestFile(f); ids.push(Number(m[1])); n++; }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[state-sync] readdir', e.message);
  }
  // Drop DB rows for state files that no longer exist (ejected/removed on disk).
  let pruned = 0;
  try { pruned = db.pruneStateExcept(ids); } catch (e) { console.error('[state-sync] prune', e.message); }
  console.log(`[state-sync] ingested ${n} state file(s) from ${STATE_DIR}${pruned ? `, pruned ${pruned} stale` : ''}`);
}

function startWatching() {
  ingestAll();
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch {}
  try {
    fs.watch(STATE_DIR, (_evt, file) => {
      if (!file) return;
      const key = String(file);
      if (timers.has(key)) clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => { timers.delete(key); ingestFile(key); }, DEBOUNCE_MS));
    });
    console.log('[state-sync] watching', STATE_DIR);
  } catch (e) {
    console.error('[state-sync] watch failed:', e.message);
  }
}

module.exports = { startWatching, ingestAll, ingestFile, STATE_DIR };
