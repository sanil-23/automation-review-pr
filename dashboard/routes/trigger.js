const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const BASE_DIR = path.resolve(__dirname, '../..');
const REVIEW_SCRIPT = path.join(BASE_DIR, 'review-single.sh');
const CRON_SCRIPT = path.join(BASE_DIR, 'cron-pr-review.sh');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');

// Track active jobs in memory
const activeJobs = new Map();

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// POST /api/trigger/review/:id
router.post('/review/:id', (req, res) => {
  const prId = parseInt(req.params.id, 10);

  // Check if already running
  if (activeJobs.has(`review-${prId}`)) {
    return res.status(409).json({ error: `Review for PR #${prId} is already running` });
  }

  const logFile = path.join(LOGS_DIR, `review-PR-${prId}-manual-${timestamp()}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const child = spawn('bash', [REVIEW_SCRIPT, String(prId)], {
    cwd: BASE_DIR,
    env: { ...process.env, PATH: process.env.PATH, DASHBOARD_MODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  const jobId = `review-${prId}`;
  activeJobs.set(jobId, {
    pid: child.pid,
    pr: prId,
    type: 'review',
    startedAt: new Date().toISOString(),
    logFile,
  });

  child.on('close', (code) => {
    logStream.end();
    activeJobs.delete(jobId);
    console.log(`[trigger] Review of PR #${prId} finished with code ${code}`);
  });

  child.on('error', (err) => {
    logStream.end();
    activeJobs.delete(jobId);
    console.error(`[trigger] Review of PR #${prId} failed: ${err.message}`);
  });

  res.json({
    jobId,
    pr: prId,
    pid: child.pid,
    logFile,
    message: `Review started for PR #${prId}`,
  });
});

// POST /api/trigger/discover
router.post('/discover', (req, res) => {
  if (activeJobs.has('discover')) {
    return res.status(409).json({ error: 'Discovery is already running' });
  }

  const logFile = path.join(LOGS_DIR, `review-${timestamp()}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const child = spawn('bash', [CRON_SCRIPT], {
    cwd: BASE_DIR,
    env: { ...process.env, PATH: process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  activeJobs.set('discover', {
    pid: child.pid,
    type: 'discover',
    startedAt: new Date().toISOString(),
    logFile,
  });

  child.on('close', (code) => {
    logStream.end();
    activeJobs.delete('discover');
    console.log(`[trigger] Discovery finished with code ${code}`);
  });

  child.on('error', (err) => {
    logStream.end();
    activeJobs.delete('discover');
    console.error(`[trigger] Discovery failed: ${err.message}`);
  });

  res.json({
    jobId: 'discover',
    pid: child.pid,
    logFile,
    message: 'Discovery started',
  });
});

// GET /api/trigger/jobs — list active jobs
router.get('/jobs', (req, res) => {
  const jobs = Object.fromEntries(activeJobs);
  res.json(jobs);
});

module.exports = router;
