const { execSync } = require('child_process');
const db = require('./db');

const REPO = 'tinyhumansai/openhuman';
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _orgMembers = null;
let _orgMembersFetchedAt = 0;
const ORG_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function ghJson(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (err) {
    console.error(`[github-sync] Command failed: ${cmd}`);
    console.error(`[github-sync] ${err.message}`);
    return null;
  }
}

function ghText(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function fetchOrgMembers() {
  const now = Date.now();
  if (_orgMembers && (now - _orgMembersFetchedAt) < ORG_CACHE_TTL) {
    return _orgMembers;
  }

  const members = ghText(`gh api orgs/tinyhumansai/members --jq '.[].login'`);
  if (members) {
    _orgMembers = new Set(members.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean));
    _orgMembersFetchedAt = now;
    console.log(`[github-sync] Cached ${_orgMembers.size} org members`);
  } else {
    _orgMembers = _orgMembers || new Set();
  }
  return _orgMembers;
}

function isInsider(login) {
  if (!login) return null;
  const members = fetchOrgMembers();
  return members.has(login.toLowerCase()) ? 1 : 0;
}

function fetchAllOpenPrs() {
  console.log(`[github-sync] Fetching open PRs from ${REPO}...`);

  // Fetch core fields first (lightweight query — no 502s)
  const coreFields = [
    'number', 'title', 'author', 'labels', 'isDraft',
    'reviewDecision', 'createdAt', 'updatedAt',
    'headRefName', 'baseRefName', 'url',
    'additions', 'deletions', 'changedFiles',
    'reviewRequests', 'assignees',
  ].join(',');

  const prs = ghJson(`gh pr list --repo ${REPO} --state open --limit 200 --json ${coreFields}`);
  if (!prs) {
    console.error('[github-sync] Failed to fetch PRs');
    return;
  }

  // Fetch mergeable status for non-draft PRs only (requires per-PR GitHub computation)
  const nonDraftPrs = prs.filter(p => !p.isDraft);
  console.log(`[github-sync] Fetching merge status for ${nonDraftPrs.length} non-draft PRs...`);
  for (const pr of nonDraftPrs) {
    try {
      const out = execSync(
        `gh pr view ${pr.number} --repo ${REPO} --json mergeable,mergeStateStatus`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const mergeInfo = JSON.parse(out);
      pr.mergeable = mergeInfo.mergeable;
      pr.mergeStateStatus = mergeInfo.mergeStateStatus;
    } catch {
      // Skip silently — merge info is optional
    }
  }

  // Fetch CI checks for non-draft PRs
  console.log(`[github-sync] Fetching CI checks for ${nonDraftPrs.length} non-draft PRs...`);
  for (const pr of nonDraftPrs) {
    try {
      const out = execSync(
        `gh pr checks ${pr.number} --repo ${REPO} --json name,bucket,link,startedAt,completedAt,workflow`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      pr._ciChecks = JSON.parse(out);
    } catch {
      // No checks or error — skip
    }
  }

  console.log(`[github-sync] Fetched ${prs.length} open PRs`);

  const existingPrs = new Map();
  for (const row of db.getAllPrs()) {
    existingPrs.set(row.id, row);
  }

  for (const pr of prs) {
    const authorLogin = pr.author?.login || '';
    const insider = isInsider(authorLogin);
    const existing = existingPrs.get(pr.number);

    // Determine status: preserve review status if we have one, otherwise derive from GH data
    let status = 'pending';
    if (existing && existing.status && existing.status !== 'pending') {
      status = existing.status;
    } else if (pr.reviewDecision === 'CHANGES_REQUESTED') {
      status = 'changes-requested';
    } else if (pr.reviewDecision === 'APPROVED') {
      status = 'clean';
    }

    const labels = (pr.labels || []).map(l => l.name).join(', ');
    const reviewers = (pr.reviewRequests || []).map(r => r.name || r.login || r.slug || '').join(', ');
    const assignees = (pr.assignees || []).map(a => a.login || '').join(', ');

    db.upsertPr({
      id: pr.number,
      title: pr.title,
      author: authorLogin,
      branch: pr.headRefName,
      base_branch: pr.baseRefName || 'main',
      url: pr.url,
      created_at: pr.createdAt,
      status,
      is_insider: insider,
      last_reviewed_commit: existing?.last_reviewed_commit || null,
      last_review_date: existing?.last_review_date || null,
      tracking_file_path: existing?.tracking_file_path || null,
      location: existing?.location || null,
    });

    // Compute CI summary
    const checks = pr._ciChecks || [];
    const ciTotal = checks.length;
    const ciPass = checks.filter(c => c.bucket === 'pass').length;
    const ciFail = checks.filter(c => c.bucket === 'fail').length;
    const ciPending = checks.filter(c => c.bucket === 'pending' || c.bucket === 'queued').length;

    // Store extended GitHub metadata
    db.upsertPrGithub({
      pr_id: pr.number,
      is_draft: pr.isDraft ? 1 : 0,
      review_decision: pr.reviewDecision || null,
      mergeable: pr.mergeable || null,
      merge_state_status: pr.mergeStateStatus || null,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changed_files: pr.changedFiles || 0,
      labels,
      reviewers,
      assignees,
      updated_at_gh: pr.updatedAt,
      last_synced: new Date().toISOString(),
      ci_checks: ciTotal > 0 ? JSON.stringify(checks) : null,
      ci_total: ciTotal,
      ci_pass: ciPass,
      ci_fail: ciFail,
      ci_pending: ciPending,
    });
  }

  // Mark PRs no longer open (closed/merged since last sync)
  db.markClosedPrs(prs.map(p => p.number));

  console.log(`[github-sync] Sync complete: ${prs.length} PRs upserted`);
}

let _interval = null;

function startPeriodicSync() {
  // Initial sync
  fetchAllOpenPrs();

  // Repeat every 5 min
  _interval = setInterval(() => {
    fetchAllOpenPrs();
  }, SYNC_INTERVAL_MS);

  console.log(`[github-sync] Periodic sync every ${SYNC_INTERVAL_MS / 1000}s`);
}

function stopPeriodicSync() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

module.exports = {
  fetchAllOpenPrs,
  fetchOrgMembers,
  isInsider,
  startPeriodicSync,
  stopPeriodicSync,
};
