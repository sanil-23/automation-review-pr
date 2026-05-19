#!/usr/bin/env node
/**
 * GitHub sync worker — runs in a child process so it never blocks the Express server.
 * Spawned by github-sync.js via fork(). Communicates results back via IPC.
 *
 * Uses `gh pr list` in batches of 50 (limit 100 causes GitHub GraphQL 502s).
 */

const { execSync } = require('child_process');

const REPO = 'tinyhumansai/openhuman';
const BATCH_SIZE = 50;
const FIELDS = 'number,title,author,isDraft,reviewDecision,createdAt,updatedAt,headRefName,baseRefName,url,reviewRequests,assignees,labels';

function exec(cmd, timeout = 30000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`[worker] Failed: ${cmd.slice(0, 120)}...`);
    console.error(`[worker] ${err.message.split('\n')[0]}`);
    return null;
  }
}

function ghJson(cmd, timeout) {
  const out = exec(cmd, timeout);
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

function run() {
  console.log(`[worker] Fetching open PRs from ${REPO}...`);

  // Batch 1: newest 50 PRs
  const batch1 = ghJson(`gh pr list --repo ${REPO} --state open --limit ${BATCH_SIZE} --json ${FIELDS}`);
  if (!batch1) {
    console.error('[worker] Failed to fetch PRs (batch 1)');
    process.send({ type: 'error', error: 'Failed to fetch PRs' });
    process.exit(1);
  }
  console.log(`[worker] Batch 1: ${batch1.length} PRs`);

  // Batch 2: older PRs (created before the oldest in batch 1)
  let batch2 = [];
  if (batch1.length >= BATCH_SIZE) {
    const oldestDate = batch1[batch1.length - 1].createdAt;
    const result = ghJson(
      `gh pr list --repo ${REPO} --state open --limit ${BATCH_SIZE} --json ${FIELDS} --search "created:<${oldestDate}"`
    );
    if (result) {
      batch2 = result;
      console.log(`[worker] Batch 2: ${batch2.length} older PRs`);
    }
  }

  // Dedup by PR number
  const seen = new Set();
  const prs = [];
  for (const pr of [...batch1, ...batch2]) {
    const num = pr.number;
    if (seen.has(num)) continue;
    seen.add(num);
    // Normalize shape to match what github-sync.js expects
    prs.push({
      number: num,
      title: pr.title,
      isDraft: pr.isDraft,
      reviewDecision: pr.reviewDecision,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      url: pr.url,
      author: pr.author ? { login: pr.author.login } : {},
      labels: (pr.labels || []),
      reviewRequests: (pr.reviewRequests || []),
      assignees: (pr.assignees || []),
    });
  }

  console.log(`[worker] Total: ${prs.length} unique open PRs`);

  // Enrich non-draft PRs with diff stats + mergeable + CI checks
  const nonDraftPrs = prs.filter(p => !p.isDraft);
  console.log(`[worker] Enriching ${nonDraftPrs.length} non-draft PRs...`);

  for (const pr of nonDraftPrs) {
    // Diff stats + mergeable in one call
    try {
      const out = exec(
        `gh pr view ${pr.number} --repo ${REPO} --json additions,deletions,changedFiles,mergeable,mergeStateStatus`,
        10000
      );
      if (out) {
        const info = JSON.parse(out);
        pr.additions = info.additions;
        pr.deletions = info.deletions;
        pr.changedFiles = info.changedFiles;
        pr.mergeable = info.mergeable;
        pr.mergeStateStatus = info.mergeStateStatus;
      }
    } catch {}

    // CI checks
    try {
      const out = exec(
        `gh pr checks ${pr.number} --repo ${REPO} --json name,bucket,link,startedAt,completedAt,workflow`,
        10000
      );
      if (out) pr._ciChecks = JSON.parse(out);
    } catch {}
  }

  // Fetch org members
  let orgMembers = [];
  try {
    const out = exec(`gh api orgs/tinyhumansai/members --jq '.[].login'`, 15000);
    if (out) {
      orgMembers = out.trim().split('\n').map(s => s.trim()).filter(Boolean);
      console.log(`[worker] Fetched ${orgMembers.length} org members`);
    }
  } catch {}

  // Send results back to parent
  process.send({
    type: 'result',
    prs,
    orgMembers,
  });

  console.log(`[worker] Done — ${prs.length} PRs sent to parent`);
}

run();
