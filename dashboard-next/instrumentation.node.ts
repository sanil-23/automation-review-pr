// Boots DB, runs initial markdown→DB migration, then starts file watchers and
// the GitHub sync worker. Mirrors what dashboard/server.js did on startup.
import path from 'path';
import fs from 'fs';

const db = require('./lib/db');
const { migrate } = require('./lib/migrate');
const sync = require('./lib/sync');
const stateSync = require('./lib/state-sync');
const githubSync = require('./lib/github-sync');
const scheduler = require('./lib/scheduler');
const config = require('./lib/config');

// Clear stale status.json from previous session
const statusFile = path.join(process.cwd(), '..', 'status.json');
try { fs.writeFileSync(statusFile, JSON.stringify({ running: false })); } catch {}

db.getDb();

// Legacy markdown tracking sync (migrate + parse the tinyhumansai-openhuman/*.md
// files). The new reviewer uses state/ + live github-sync instead, so this is
// OFF by default — it synchronously parses hundreds of .md files at startup and
// blocks the event loop on slow boxes. Enable with legacy_md_sync = true.
if (config.readConfig().legacy_md_sync === true) {
  console.log('[server] Running legacy markdown migration + sync...');
  migrate();
  sync.startWatching();
} else {
  console.log('[server] legacy markdown sync disabled (set legacy_md_sync=true to enable)');
}

stateSync.startWatching();
githubSync.startPeriodicSync();
scheduler.start();   // in-process cron — backend + frontend are one app

console.log('[server] dashboard-next ready');
