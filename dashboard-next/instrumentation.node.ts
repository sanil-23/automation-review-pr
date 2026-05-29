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

// Clear stale status.json from previous session
const statusFile = path.join(process.cwd(), '..', 'status.json');
try { fs.writeFileSync(statusFile, JSON.stringify({ running: false })); } catch {}

db.getDb();

console.log('[server] Running initial migration...');
migrate();

sync.startWatching();
stateSync.startWatching();
githubSync.startPeriodicSync();
scheduler.start();   // in-process cron — backend + frontend are one app

console.log('[server] dashboard-next ready');
