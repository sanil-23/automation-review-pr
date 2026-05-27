const express = require('express');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const router = express.Router();

const BASE_DIR = path.resolve(__dirname, '../..');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const CRON_SCRIPT = path.join(BASE_DIR, 'cron-pr-review.sh');
const ENV_FILE = path.join(BASE_DIR, '.env');
const REVIEWER_DIR = path.join(BASE_DIR, 'reviewers');

const LAUNCHD_LABEL = 'com.graycyrus.pr-review';
const LAUNCHD_PLIST = path.join(process.env.HOME || '/Users/cyrus', 'Library/LaunchAgents', `${LAUNCHD_LABEL}.plist`);

// --- Helpers ---

function getLaunchdStatus() {
  const uid = process.getuid ? process.getuid() : 504;
  try {
    const out = execSync(`launchctl print gui/${uid}/${LAUNCHD_LABEL} 2>/dev/null`, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    const active = !out.includes('could not find service');
    // Extract interval
    let interval = 3600;
    const intervalMatch = out.match(/interval\s*=\s*(\d+)/i);
    if (intervalMatch) interval = parseInt(intervalMatch[1]);
    // Try from plist
    if (interval === 3600 && fs.existsSync(LAUNCHD_PLIST)) {
      try {
        const plist = fs.readFileSync(LAUNCHD_PLIST, 'utf-8');
        const m = plist.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
        if (m) interval = parseInt(m[1]);
      } catch {}
    }
    return { active: true, interval };
  } catch {
    // Not loaded — check if plist exists
    if (fs.existsSync(LAUNCHD_PLIST)) {
      let interval = 3600;
      try {
        const plist = fs.readFileSync(LAUNCHD_PLIST, 'utf-8');
        const m = plist.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
        if (m) interval = parseInt(m[1]);
      } catch {}
      return { active: false, interval };
    }
    return { active: false, interval: 3600 };
  }
}

function intervalToHuman(seconds) {
  if (seconds < 60) return `Every ${seconds}s`;
  const min = seconds / 60;
  if (min < 60) return `Every ${min} minutes`;
  const hr = min / 60;
  if (hr === 1) return 'Every hour';
  return `Every ${hr} hours`;
}

function getReviewerInfo() {
  let reviewer = 'cyrus';
  try {
    const env = fs.readFileSync(ENV_FILE, 'utf-8');
    const match = env.match(/^REVIEWER=(.+)$/m);
    if (match) reviewer = match[1].trim();
  } catch {}

  const identityFile = path.join(REVIEWER_DIR, `${reviewer}.md`);
  let identity = null;
  try {
    identity = fs.readFileSync(identityFile, 'utf-8');
  } catch {}

  return { name: reviewer, file: identityFile, exists: !!identity, content: identity };
}

function parseCronLogs() {
  const runs = [];
  try {
    const files = fs.readdirSync(LOGS_DIR)
      .filter(f => f.match(/^review-\d{4}-\d{2}-\d{2}[T-]\d{2,4}.*\.log$/) && !f.includes('-PR-'))
      .sort()
      .reverse()
      .slice(0, 50);

    for (const file of files) {
      const content = fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8');
      const meta = content.match(/CRON_META:\s*started=(\S+)\s+ended=(\S+)\s+discovered=(\d+)\s+reviewed=(\d+)\s+failed=(\d+)/);

      const run = {
        log_file: file,
        log_path: path.join(LOGS_DIR, file),
        status: 'unknown',
      };

      if (meta) {
        run.started_at = meta[1];
        run.ended_at = meta[2];
        run.discovered = parseInt(meta[3]);
        run.reviewed = parseInt(meta[4]);
        run.failed = parseInt(meta[5]);
        const start = new Date(meta[1]);
        const end = new Date(meta[2]);
        run.duration = Math.round((end - start) / 1000);
        run.status = run.failed > 0 ? 'failed' : 'success';
      } else {
        // Extract timestamp from filename (cron format: review-2026-05-26-2321.log or trigger format: review-2026-05-26T23-21-47.log)
        const ts1 = file.match(/review-(\d{4}-\d{2}-\d{2})-(\d{4})/);
        const ts2 = file.match(/review-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
        if (ts1) {
          run.started_at = `${ts1[1]}T${ts1[2].slice(0,2)}:${ts1[2].slice(2)}:00Z`;
        } else if (ts2) {
          run.started_at = `${ts2[1]}T${ts2[2]}:${ts2[3]}:00Z`;
        }

        if (content.includes('No eligible PRs found')) {
          run.discovered = 0;
          run.reviewed = 0;
          run.failed = 0;
          run.duration = 0;
          run.status = 'no_prs';
        } else if (content.includes('=== Done ===')) {
          // Script finished but no CRON_META — parse summary if possible
          const summaryMatch = content.match(/Discovered:\s*(\d+).*\nSucceeded:\s*(\d+).*\nFailed:\s*(\d+)/);
          if (summaryMatch) {
            run.discovered = parseInt(summaryMatch[1]);
            run.reviewed = parseInt(summaryMatch[2]);
            run.failed = parseInt(summaryMatch[3]);
            run.status = run.failed > 0 ? 'failed' : 'success';
          } else {
            run.status = 'success';
          }
        } else {
          // No CRON_META, no "Done" — check if file is still being written to
          const stat = fs.statSync(path.join(LOGS_DIR, file));
          const ageMs = Date.now() - stat.mtimeMs;
          if (ageMs > 5 * 60 * 1000) {
            // Not modified in 5+ minutes — stalled/failed
            run.status = 'failed';
          } else {
            run.status = 'running';
          }
        }
      }

      runs.push(run);
    }
  } catch {}
  return runs;
}

// --- Routes ---

// GET /api/cron/status
router.get('/status', (req, res) => {
  const launchd = getLaunchdStatus();
  const reviewer = getReviewerInfo();

  // Check if cron/review processes are running
  let running = false;
  try {
    execSync('pgrep -f "cron-pr-review.sh" >/dev/null 2>&1');
    running = true;
  } catch {}

  const intervalMin = launchd.interval / 60;

  res.json({
    active: launchd.active,
    running,
    schedule: `Every ${intervalMin} min`,
    human_schedule: intervalToHuman(launchd.interval),
    interval_seconds: launchd.interval,
    next_run: null,
    script: CRON_SCRIPT,
    reviewer,
  });
});

// POST /api/cron/toggle
router.post('/toggle', (req, res) => {
  const launchd = getLaunchdStatus();
  const uid = process.getuid ? process.getuid() : 504;

  try {
    if (launchd.active) {
      // Disable
      execSync(`launchctl bootout gui/${uid}/${LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'ignore', timeout: 5000 });
      res.json({ active: false, message: 'Scheduler deactivated' });
    } else {
      // Enable
      if (!fs.existsSync(LAUNCHD_PLIST)) {
        return res.status(500).json({ error: 'LaunchAgent plist not found' });
      }
      try { execSync(`launchctl bootout gui/${uid}/${LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'ignore', timeout: 5000 }); } catch {}
      execSync(`launchctl bootstrap gui/${uid} "${LAUNCHD_PLIST}"`, { encoding: 'utf-8', timeout: 5000 });
      res.json({ active: true, message: 'Scheduler activated' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle scheduler', details: err.message });
  }
});

// POST /api/cron/schedule — update the schedule interval
router.post('/schedule', (req, res) => {
  // Accept minutes as a number or a cron expression (extract minutes from it)
  let { schedule, minutes } = req.body;

  if (minutes) {
    minutes = parseInt(minutes, 10);
  } else if (schedule) {
    // Try to parse cron expression to extract minutes
    const parts = schedule.trim().split(/\s+/);
    if (parts[0].includes('/')) {
      minutes = parseInt(parts[0].split('/')[1], 10);
    } else if (parts[0] === '0' && parts[1] === '*') {
      minutes = 60;
    } else if (parts[1] && parts[1].includes('/')) {
      minutes = parseInt(parts[1].split('/')[1], 10) * 60;
    } else {
      minutes = 60;
    }
  } else {
    return res.status(400).json({ error: 'Provide minutes or schedule' });
  }

  if (!minutes || minutes < 5) {
    return res.status(400).json({ error: 'Minimum interval is 5 minutes' });
  }

  const seconds = minutes * 60;

  // Update the plist
  if (!fs.existsSync(LAUNCHD_PLIST)) {
    return res.status(500).json({ error: 'LaunchAgent plist not found' });
  }

  try {
    execSync(`/usr/libexec/PlistBuddy -c "Set :StartInterval ${seconds}" "${LAUNCHD_PLIST}"`, { encoding: 'utf-8', timeout: 5000 });

    // Reload if active
    const uid = process.getuid ? process.getuid() : 504;
    try {
      execSync(`launchctl bootout gui/${uid}/${LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'ignore', timeout: 5000 });
      execSync(`launchctl bootstrap gui/${uid} "${LAUNCHD_PLIST}"`, { encoding: 'utf-8', timeout: 5000 });
    } catch {}

    res.json({ minutes, human: intervalToHuman(seconds) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update schedule', details: err.message });
  }
});

// GET /api/cron/history
router.get('/history', (req, res) => {
  const runs = parseCronLogs();
  res.json(runs);
});

// GET /api/cron/log/:filename
router.get('/log/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(LOGS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Log not found' });
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  res.type('text/plain').send(content);
});

// GET /api/cron/reviewers — list available reviewer identities
router.get('/reviewers', (req, res) => {
  try {
    const files = fs.readdirSync(REVIEWER_DIR).filter(f => f.endsWith('.md'));
    const reviewers = files.map(f => {
      const name = f.replace('.md', '');
      const content = fs.readFileSync(path.join(REVIEWER_DIR, f), 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)/m);
      return {
        name,
        file: f,
        title: titleMatch ? titleMatch[1] : name,
      };
    });
    res.json(reviewers);
  } catch {
    res.json([]);
  }
});

// POST /api/cron/stop — kill ALL running cron + review processes
router.post('/stop', (req, res) => {
  const killed = [];

  try {
    // Kill cron-pr-review.sh and all its children
    const cronPids = execSync(`pgrep -f "cron-pr-review.sh" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    for (const pid of cronPids) {
      try { execSync(`pkill -TERM -P ${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 }); } catch {}
      killed.push({ type: 'cron', pid });
    }
  } catch {}

  try {
    // Kill review-single.sh processes
    const reviewPids = execSync(`pgrep -f "review-single.sh" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    for (const pid of reviewPids) {
      try { execSync(`pkill -TERM -P ${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 }); } catch {}
      killed.push({ type: 'review', pid });
    }
  } catch {}

  try {
    // Kill any claude processes spawned by reviews
    const claudePids = execSync(`pgrep -f "claude.*-p" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    for (const pid of claudePids) {
      try { process.kill(parseInt(pid), 'SIGTERM'); } catch {}
      killed.push({ type: 'claude', pid });
    }
  } catch {}

  // Clear status.json
  const statusFile = path.join(BASE_DIR, 'status.json');
  try { fs.writeFileSync(statusFile, JSON.stringify({ running: false })); } catch {}

  res.json({ message: `Stopped ${killed.length} process(es)`, killed });
});

module.exports = router;
