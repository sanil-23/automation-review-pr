const Database = require('better-sqlite3');
const path = require('path');

// process.cwd() is the dashboard-next/ project root under `next dev|start`.
// Using __dirname would be brittle because webpack bundles server code.
const DB_PATH = path.join(process.cwd(), 'data', 'reviews.db');

let _db = null;

function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS prs (
      id INTEGER PRIMARY KEY,
      title TEXT,
      author TEXT,
      branch TEXT,
      base_branch TEXT DEFAULT 'main',
      url TEXT,
      created_at TEXT,
      status TEXT,
      is_draft INTEGER DEFAULT 0,
      is_member INTEGER,
      last_reviewed_commit TEXT,
      last_review_date TEXT,
      tracking_file_path TEXT,
      location TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_id INTEGER REFERENCES prs(id),
      cycle_number INTEGER,
      type TEXT,
      status TEXT DEFAULT 'completed',
      started_at TEXT,
      ended_at TEXT,
      duration_seconds INTEGER,
      commit_sha TEXT,
      summary TEXT,
      gates TEXT,
      areas_changed TEXT,
      findings_critical INTEGER DEFAULT 0,
      findings_major INTEGER DEFAULT 0,
      findings_minor INTEGER DEFAULT 0,
      action_taken TEXT,
      github_review_url TEXT,
      coderabbit_dedup TEXT,
      resolution_actions TEXT,
      log_file_path TEXT,
      reviewer TEXT DEFAULT 'graycyrus',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cron_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT,
      ended_at TEXT,
      duration_seconds INTEGER,
      prs_discovered INTEGER,
      prs_reviewed INTEGER,
      prs_skipped INTEGER,
      prs_failed INTEGER,
      log_file_path TEXT
    );

    CREATE TABLE IF NOT EXISTS pr_github (
      pr_id INTEGER PRIMARY KEY REFERENCES prs(id),
      is_draft INTEGER DEFAULT 0,
      review_decision TEXT,
      mergeable TEXT,
      merge_state_status TEXT,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      changed_files INTEGER DEFAULT 0,
      labels TEXT,
      reviewers TEXT,
      assignees TEXT,
      updated_at_gh TEXT,
      last_synced TEXT,
      is_open INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS pr_state (
      pr_id INTEGER PRIMARY KEY REFERENCES prs(id),
      fsm_state TEXT,                 -- NEW / IN_REVIEW / CHANGES_REQUESTED / CLEAN /
                                      -- QUEUED_FOR_FIX / FIXING / AWAIT_CI / READY_MERGE /
                                      -- MERGED / WINNER / CLOSED_LOSER / CLOSED_REDUNDANT
      queue TEXT,                     -- review | fix | none
      linked_issue INTEGER,
      winner_pr INTEGER,
      dedup_verdict TEXT,
      signature TEXT,
      last_reviewed_signature TEXT,
      last_review_at TEXT,
      review_decision TEXT,
      ci_state TEXT,
      coderabbit_approved INTEGER DEFAULT 0,
      findings_critical INTEGER DEFAULT 0,
      findings_major INTEGER DEFAULT 0,
      findings_minor INTEGER DEFAULT 0,
      last_author_activity_at TEXT,
      stall_age_hours INTEGER DEFAULT 0,
      queued_for_fix_at TEXT,
      fix_phase TEXT,                 -- fix | coverage | await_ci | merge
      worker_slot INTEGER,
      takeover_started_at TEXT,
      last_error TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_prs_status ON prs(status);
    CREATE INDEX IF NOT EXISTS idx_cycles_pr ON review_cycles(pr_id);
    CREATE INDEX IF NOT EXISTS idx_pr_github_open ON pr_github(is_open);
    CREATE INDEX IF NOT EXISTS idx_pr_state_fsm ON pr_state(fsm_state);
    CREATE INDEX IF NOT EXISTS idx_pr_state_queue ON pr_state(queue);
    CREATE INDEX IF NOT EXISTS idx_pr_state_issue ON pr_state(linked_issue);
  `);

  // Migrate: rename is_insider → is_member
  const prCols = _db.prepare("PRAGMA table_info(prs)").all().map(c => c.name);
  if (prCols.includes('is_insider')) {
    _db.exec(`ALTER TABLE prs RENAME COLUMN is_insider TO is_member`);
  }

  // Migrate: add CI columns if they don't exist
  const cols = _db.prepare("PRAGMA table_info(pr_github)").all().map(c => c.name);
  if (!cols.includes('ci_checks')) {
    _db.exec(`
      ALTER TABLE pr_github ADD COLUMN ci_checks TEXT;
      ALTER TABLE pr_github ADD COLUMN ci_total INTEGER DEFAULT 0;
      ALTER TABLE pr_github ADD COLUMN ci_pass INTEGER DEFAULT 0;
      ALTER TABLE pr_github ADD COLUMN ci_fail INTEGER DEFAULT 0;
      ALTER TABLE pr_github ADD COLUMN ci_pending INTEGER DEFAULT 0;
    `);
  }

  const cycleCols = _db.prepare("PRAGMA table_info(review_cycles)").all().map(c => c.name);
  if (!cycleCols.includes('summary')) {
    _db.exec(`ALTER TABLE review_cycles ADD COLUMN summary TEXT`);
  }
  if (!cycleCols.includes('resolution_actions')) {
    _db.exec(`ALTER TABLE review_cycles ADD COLUMN resolution_actions TEXT`);
  }

  return _db;
}

// --- PR queries ---

const prQueries = {
  upsert: `INSERT INTO prs (id, title, author, branch, base_branch, url, created_at, status, is_member, last_reviewed_commit, last_review_date, tracking_file_path, location, updated_at)
    VALUES (@id, @title, @author, @branch, @base_branch, @url, @created_at, @status, @is_member, @last_reviewed_commit, @last_review_date, @tracking_file_path, @location, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=@title, author=@author, branch=@branch, base_branch=@base_branch, url=@url,
      status=@status, is_member=@is_member, last_reviewed_commit=@last_reviewed_commit,
      last_review_date=@last_review_date, tracking_file_path=@tracking_file_path,
      location=@location, updated_at=datetime('now')`,

  getAll: `SELECT * FROM prs ORDER BY id DESC`,

  getById: `SELECT * FROM prs WHERE id = ?`,

  getStats: `SELECT
    COUNT(*) as total,
    SUM(CASE WHEN g.is_draft = 1 THEN 1 ELSE 0 END) as drafts,
    SUM(CASE WHEN p.status = 'under-review' THEN 1 ELSE 0 END) as under_review,
    SUM(CASE WHEN p.status = 'changes-requested' THEN 1 ELSE 0 END) as changes_requested,
    SUM(CASE WHEN p.status = 'clean' THEN 1 ELSE 0 END) as clean,
    SUM(CASE WHEN p.status = 'blocked' THEN 1 ELSE 0 END) as blocked,
    SUM(CASE WHEN p.status = 'pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN p.status = 'merged' THEN 1 ELSE 0 END) as merged,
    SUM(CASE WHEN p.status = 'closed' THEN 1 ELSE 0 END) as closed
    FROM prs p
    LEFT JOIN pr_github g ON g.pr_id = p.id`,
};

const cycleQueries = {
  deleteForPr: `DELETE FROM review_cycles WHERE pr_id = ?`,

  insert: `INSERT INTO review_cycles (pr_id, cycle_number, type, status, started_at, ended_at, duration_seconds, commit_sha, summary, gates, areas_changed, findings_critical, findings_major, findings_minor, action_taken, github_review_url, coderabbit_dedup, resolution_actions, log_file_path, reviewer, updated_at)
    VALUES (@pr_id, @cycle_number, @type, @status, @started_at, @ended_at, @duration_seconds, @commit_sha, @summary, @gates, @areas_changed, @findings_critical, @findings_major, @findings_minor, @action_taken, @github_review_url, @coderabbit_dedup, @resolution_actions, @log_file_path, @reviewer, datetime('now'))`,

  getByPr: `SELECT * FROM review_cycles WHERE pr_id = ? ORDER BY cycle_number ASC`,
};

const cronQueries = {
  insert: `INSERT INTO cron_runs (started_at, ended_at, duration_seconds, prs_discovered, prs_reviewed, prs_skipped, prs_failed, log_file_path)
    VALUES (@started_at, @ended_at, @duration_seconds, @prs_discovered, @prs_reviewed, @prs_skipped, @prs_failed, @log_file_path)`,

  getAll: `SELECT * FROM cron_runs ORDER BY started_at DESC`,
};

function upsertPr(data) {
  const db = getDb();
  return db.prepare(prQueries.upsert).run(data);
}

function getAllPrs() {
  const db = getDb();
  return db.prepare(prQueries.getAll).all();
}

function getPrById(id) {
  const db = getDb();
  return db.prepare(prQueries.getById).get(id);
}

function getStats() {
  const db = getDb();
  return db.prepare(prQueries.getStats).get();
}

function replaceCyclesForPr(prId, cycles) {
  const db = getDb();
  const deleteStmt = db.prepare(cycleQueries.deleteForPr);
  const insertStmt = db.prepare(cycleQueries.insert);

  const tx = db.transaction((prId, cycles) => {
    deleteStmt.run(prId);
    for (const cycle of cycles) {
      insertStmt.run({ ...cycle, pr_id: prId });
    }
  });

  tx(prId, cycles);
}

function getCyclesByPr(prId) {
  const db = getDb();
  return db.prepare(cycleQueries.getByPr).all(prId);
}

function insertCronRun(data) {
  const db = getDb();
  return db.prepare(cronQueries.insert).run(data);
}

function getAllCronRuns() {
  const db = getDb();
  return db.prepare(cronQueries.getAll).all();
}

function getPrsWithLatestCycle() {
  const db = getDb();
  return db.prepare(`
    SELECT p.*,
      g.is_draft as gh_is_draft,
      g.review_decision,
      g.mergeable,
      g.merge_state_status,
      g.additions,
      g.deletions,
      g.changed_files,
      g.labels,
      g.reviewers,
      g.assignees,
      g.updated_at_gh,
      g.is_open,
      g.ci_checks,
      g.ci_total,
      g.ci_pass,
      g.ci_fail,
      g.ci_pending,
      rc.cycle_number as latest_cycle,
      rc.status as cycle_status,
      rc.started_at as cycle_started,
      rc.ended_at as cycle_ended,
      rc.duration_seconds as cycle_duration,
      rc.findings_critical,
      rc.findings_major,
      rc.findings_minor,
      rc.action_taken
    FROM prs p
    LEFT JOIN pr_github g ON g.pr_id = p.id
    LEFT JOIN review_cycles rc ON rc.pr_id = p.id
      AND rc.cycle_number = (SELECT MAX(rc2.cycle_number) FROM review_cycles rc2 WHERE rc2.pr_id = p.id)
    ORDER BY p.id DESC
  `).all();
}

function getPrByIdFull(id) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*,
      g.is_draft as gh_is_draft,
      g.review_decision,
      g.mergeable,
      g.merge_state_status,
      g.additions,
      g.deletions,
      g.changed_files,
      g.labels,
      g.reviewers,
      g.assignees,
      g.updated_at_gh,
      g.is_open,
      g.ci_checks,
      g.ci_total,
      g.ci_pass,
      g.ci_fail,
      g.ci_pending
    FROM prs p
    LEFT JOIN pr_github g ON g.pr_id = p.id
    WHERE p.id = ?
  `).get(id);
}

function upsertPrGithub(data) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO pr_github (pr_id, is_draft, review_decision, mergeable, merge_state_status, additions, deletions, changed_files, labels, reviewers, assignees, updated_at_gh, last_synced, is_open, ci_checks, ci_total, ci_pass, ci_fail, ci_pending)
    VALUES (@pr_id, @is_draft, @review_decision, @mergeable, @merge_state_status, @additions, @deletions, @changed_files, @labels, @reviewers, @assignees, @updated_at_gh, @last_synced, 1, @ci_checks, @ci_total, @ci_pass, @ci_fail, @ci_pending)
    ON CONFLICT(pr_id) DO UPDATE SET
      is_draft=@is_draft, review_decision=@review_decision, mergeable=@mergeable,
      merge_state_status=@merge_state_status, additions=@additions, deletions=@deletions,
      changed_files=@changed_files, labels=@labels, reviewers=@reviewers, assignees=@assignees,
      updated_at_gh=@updated_at_gh, last_synced=@last_synced, is_open=1,
      ci_checks=@ci_checks, ci_total=@ci_total, ci_pass=@ci_pass, ci_fail=@ci_fail, ci_pending=@ci_pending
  `).run(data);
}

/**
 * Query PRs with dynamic filters, sorting, and search.
 * All filtering happens in SQLite — no client-side filtering needed.
 *
 * Supported filters (all optional):
 *   status, author, member (1/0), draft (1/0), mergeable,
 *   review_decision, label, has_review (1/0), has_findings (1/0),
 *   merge_state, is_open (1/0), search (free text), assignee, reviewer,
 *   min_additions, max_additions, min_deletions, max_deletions,
 *   created_after, created_before,
 *   sort (field name), order (asc/desc)
 */
function queryPrs(filters = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  // --- Exclude merged/closed by default ---
  if (!filters.include_merged) {
    conditions.push("p.status NOT IN ('merged', 'closed')");
  }

  // --- Status ---
  if (filters.status) {
    conditions.push('p.status = ?');
    params.push(filters.status);
  }

  // --- Author ---
  if (filters.author) {
    conditions.push('LOWER(p.author) = LOWER(?)');
    params.push(filters.author);
  }

  // --- Member/Collaborator ---
  if (filters.member !== undefined && filters.member !== '') {
    conditions.push('p.is_member = ?');
    params.push(parseInt(filters.member, 10));
  }

  // --- Draft ---
  if (filters.draft !== undefined && filters.draft !== '') {
    conditions.push('g.is_draft = ?');
    params.push(parseInt(filters.draft, 10));
  }

  // --- Mergeable ---
  if (filters.mergeable) {
    conditions.push('g.mergeable = ?');
    params.push(filters.mergeable);
  }

  // --- Review Decision ---
  if (filters.review_decision) {
    if (filters.review_decision === 'NONE') {
      conditions.push("(g.review_decision IS NULL OR g.review_decision = '')");
    } else {
      conditions.push('g.review_decision = ?');
      params.push(filters.review_decision);
    }
  }

  // --- Label (partial match) ---
  if (filters.label) {
    conditions.push("g.labels LIKE '%' || ? || '%'");
    params.push(filters.label);
  }

  // --- Has Review (at least one cycle) ---
  if (filters.has_review !== undefined && filters.has_review !== '') {
    if (parseInt(filters.has_review, 10) === 1) {
      conditions.push('rc.cycle_number IS NOT NULL');
    } else {
      conditions.push('rc.cycle_number IS NULL');
    }
  }

  // --- Has Findings ---
  if (filters.has_findings !== undefined && filters.has_findings !== '') {
    if (parseInt(filters.has_findings, 10) === 1) {
      conditions.push('(rc.findings_critical > 0 OR rc.findings_major > 0 OR rc.findings_minor > 0)');
    } else {
      conditions.push('(rc.findings_critical IS NULL OR (rc.findings_critical = 0 AND rc.findings_major = 0 AND rc.findings_minor = 0))');
    }
  }

  // --- Merge State ---
  if (filters.merge_state) {
    conditions.push('g.merge_state_status = ?');
    params.push(filters.merge_state);
  }

  // --- Is Open ---
  if (filters.is_open !== undefined && filters.is_open !== '') {
    conditions.push('g.is_open = ?');
    params.push(parseInt(filters.is_open, 10));
  }

  // --- Assignee ---
  if (filters.assignee) {
    conditions.push("g.assignees LIKE '%' || ? || '%'");
    params.push(filters.assignee);
  }

  // --- Reviewer ---
  if (filters.reviewer) {
    conditions.push("g.reviewers LIKE '%' || ? || '%'");
    params.push(filters.reviewer);
  }

  // --- Diff size filters ---
  if (filters.min_additions) {
    conditions.push('g.additions >= ?');
    params.push(parseInt(filters.min_additions, 10));
  }
  if (filters.max_additions) {
    conditions.push('g.additions <= ?');
    params.push(parseInt(filters.max_additions, 10));
  }
  if (filters.min_deletions) {
    conditions.push('g.deletions >= ?');
    params.push(parseInt(filters.min_deletions, 10));
  }
  if (filters.max_deletions) {
    conditions.push('g.deletions <= ?');
    params.push(parseInt(filters.max_deletions, 10));
  }

  // --- Date filters ---
  if (filters.created_after) {
    conditions.push('p.created_at >= ?');
    params.push(filters.created_after);
  }
  if (filters.created_before) {
    conditions.push('p.created_at <= ?');
    params.push(filters.created_before);
  }

  // --- CI Status ---
  if (filters.ci_status) {
    if (filters.ci_status === 'pass') {
      conditions.push('g.ci_total > 0 AND g.ci_fail = 0 AND g.ci_pending = 0');
    } else if (filters.ci_status === 'fail') {
      conditions.push('g.ci_fail > 0');
    } else if (filters.ci_status === 'pending') {
      conditions.push('g.ci_pending > 0');
    }
  }

  // --- Free text search ---
  if (filters.search) {
    conditions.push("(CAST(p.id AS TEXT) LIKE '%' || ? || '%' OR LOWER(p.title) LIKE '%' || LOWER(?) || '%' OR LOWER(p.author) LIKE '%' || LOWER(?) || '%' OR LOWER(g.labels) LIKE '%' || LOWER(?) || '%')");
    params.push(filters.search, filters.search, filters.search, filters.search);
  }

  // --- Build WHERE clause ---
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // --- Sorting ---
  const sortableFields = {
    'id': 'p.id',
    'title': 'p.title',
    'author': 'p.author',
    'status': 'p.status',
    'created': 'p.created_at',
    'updated': 'g.updated_at_gh',
    'additions': 'g.additions',
    'deletions': 'g.deletions',
    'changed_files': 'g.changed_files',
    'cycles': 'rc.cycle_number',
    'last_reviewed': 'p.last_review_date',
    'duration': 'rc.duration_seconds',
    'findings': '(COALESCE(rc.findings_critical,0)*100 + COALESCE(rc.findings_major,0)*10 + COALESCE(rc.findings_minor,0))',
  };
  const sortField = sortableFields[filters.sort] || 'p.id';
  const sortOrder = filters.order === 'asc' ? 'ASC' : 'DESC';

  const sql = `
    SELECT p.*,
      g.is_draft as gh_is_draft,
      g.review_decision,
      g.mergeable,
      g.merge_state_status,
      g.additions,
      g.deletions,
      g.changed_files,
      g.labels,
      g.reviewers,
      g.assignees,
      g.updated_at_gh,
      g.is_open,
      g.ci_checks,
      g.ci_total,
      g.ci_pass,
      g.ci_fail,
      g.ci_pending,
      rc.cycle_number as latest_cycle,
      rc.status as cycle_status,
      rc.started_at as cycle_started,
      rc.ended_at as cycle_ended,
      rc.duration_seconds as cycle_duration,
      rc.findings_critical,
      rc.findings_major,
      rc.findings_minor,
      rc.action_taken
    FROM prs p
    LEFT JOIN pr_github g ON g.pr_id = p.id
    LEFT JOIN review_cycles rc ON rc.pr_id = p.id
      AND rc.cycle_number = (SELECT MAX(rc2.cycle_number) FROM review_cycles rc2 WHERE rc2.pr_id = p.id)
    ${where}
    ORDER BY ${sortField} ${sortOrder}
  `;

  return db.prepare(sql).all(...params);
}

/**
 * Get distinct values for filter dropdowns.
 */
function getFilterOptions() {
  const db = getDb();

  const authors = db.prepare('SELECT DISTINCT author FROM prs WHERE author IS NOT NULL ORDER BY author').all().map(r => r.author);
  const statuses = db.prepare("SELECT DISTINCT status FROM prs WHERE status IS NOT NULL ORDER BY status").all().map(r => r.status);
  const labels = db.prepare("SELECT DISTINCT labels FROM pr_github WHERE labels IS NOT NULL AND labels != '' ORDER BY labels").all().map(r => r.labels);
  const mergeStates = db.prepare("SELECT DISTINCT merge_state_status FROM pr_github WHERE merge_state_status IS NOT NULL ORDER BY merge_state_status").all().map(r => r.merge_state_status);

  // Flatten labels (they're comma-separated)
  const uniqueLabels = [...new Set(labels.flatMap(l => l.split(', ').map(s => s.trim())).filter(Boolean))].sort();

  return { authors, statuses, labels: uniqueLabels, mergeStates };
}

function updatePrStatus(id, status) {
  const db = getDb();
  db.prepare("UPDATE prs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

function updatePrTrackingPath(id, newPath, location) {
  const db = getDb();
  db.prepare("UPDATE prs SET tracking_file_path = ?, location = ?, updated_at = datetime('now') WHERE id = ?").run(newPath, location, id);
}

function markPrNotOpen(id) {
  const db = getDb();
  db.prepare('UPDATE pr_github SET is_open = 0 WHERE pr_id = ?').run(id);
}

function markClosedPrs(openPrIds) {
  const db = getDb();
  if (openPrIds.length === 0) return;
  const placeholders = openPrIds.map(() => '?').join(',');
  db.prepare(`UPDATE pr_github SET is_open = 0 WHERE pr_id NOT IN (${placeholders}) AND is_open = 1`).run(...openPrIds);
}

// ── pr_state (FSM store mirror of state/pr-<N>.json) ────────────────────────
const REVIEW_QUEUE_STATES = ['IN_REVIEW', 'CHANGES_REQUESTED', 'CLEAN', 'NEW'];
const FIX_QUEUE_STATES = ['QUEUED_FOR_FIX', 'FIXING', 'AWAIT_CI', 'READY_MERGE'];
const TAKEOVER_ACTIVE = ['FIXING', 'AWAIT_CI', 'READY_MERGE'];

function upsertPrState(s) {
  const db = getDb();
  // Ensure a parent prs row exists (state may arrive before github-sync).
  db.prepare(`INSERT INTO prs (id, title, url, author, status, updated_at)
              VALUES (@pr, @title, @url, @author, @status, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                title=COALESCE(excluded.title, prs.title),
                url=COALESCE(excluded.url, prs.url),
                author=COALESCE(excluded.author, prs.author)`).run({
    pr: s.pr, title: s.title || null, url: s.url || null,
    author: s.author || null, status: (s.fsm_state || '').toLowerCase(),
  });
  db.prepare(`
    INSERT INTO pr_state (
      pr_id, fsm_state, queue, linked_issue, winner_pr, dedup_verdict,
      signature, last_reviewed_signature, last_review_at, review_decision,
      ci_state, coderabbit_approved, findings_critical, findings_major, findings_minor,
      last_author_activity_at, stall_age_hours, queued_for_fix_at,
      fix_phase, worker_slot, takeover_started_at, last_error, updated_at
    ) VALUES (
      @pr_id, @fsm_state, @queue, @linked_issue, @winner_pr, @dedup_verdict,
      @signature, @last_reviewed_signature, @last_review_at, @review_decision,
      @ci_state, @coderabbit_approved, @fc, @fm, @fn,
      @last_author_activity_at, @stall_age_hours, @queued_for_fix_at,
      @fix_phase, @worker_slot, @takeover_started_at, @last_error, @updated_at
    )
    ON CONFLICT(pr_id) DO UPDATE SET
      fsm_state=excluded.fsm_state, queue=excluded.queue, linked_issue=excluded.linked_issue,
      winner_pr=excluded.winner_pr, dedup_verdict=excluded.dedup_verdict,
      signature=excluded.signature, last_reviewed_signature=excluded.last_reviewed_signature,
      last_review_at=excluded.last_review_at, review_decision=excluded.review_decision,
      ci_state=excluded.ci_state, coderabbit_approved=excluded.coderabbit_approved,
      findings_critical=excluded.findings_critical, findings_major=excluded.findings_major,
      findings_minor=excluded.findings_minor,
      last_author_activity_at=excluded.last_author_activity_at,
      stall_age_hours=excluded.stall_age_hours, queued_for_fix_at=excluded.queued_for_fix_at,
      fix_phase=excluded.fix_phase, worker_slot=excluded.worker_slot,
      takeover_started_at=excluded.takeover_started_at, last_error=excluded.last_error,
      updated_at=excluded.updated_at
  `).run({
    pr_id: s.pr,
    fsm_state: s.fsm_state || null, queue: s.queue || null,
    linked_issue: s.linked_issue ?? null, winner_pr: s.winner_pr ?? null,
    dedup_verdict: s.dedup_verdict || null,
    signature: s.signature || null, last_reviewed_signature: s.last_reviewed_signature || null,
    last_review_at: s.last_review_at || null, review_decision: s.review_decision || null,
    ci_state: s.ci_state || null, coderabbit_approved: s.coderabbit_approved ? 1 : 0,
    fc: s.findings?.critical ?? 0, fm: s.findings?.major ?? 0, fn: s.findings?.minor ?? 0,
    last_author_activity_at: s.last_author_activity_at || null,
    stall_age_hours: s.stall_age_hours ?? 0, queued_for_fix_at: s.queued_for_fix_at || null,
    fix_phase: s.fix_phase || null, worker_slot: s.worker_slot ?? null,
    takeover_started_at: s.takeover_started_at || null, last_error: s.last_error || null,
    updated_at: s.updated_at || new Date().toISOString(),
  });
}

const STATE_SELECT = `
  SELECT s.*, p.title, p.author, p.url,
         g.ci_pass, g.ci_fail, g.ci_pending, g.review_decision AS gh_review_decision,
         g.merge_state_status
  FROM pr_state s
  JOIN prs p ON p.id = s.pr_id
  LEFT JOIN pr_github g ON g.pr_id = s.pr_id`;

function _placeholders(arr) { return arr.map(() => '?').join(','); }

// { review: [...], fix: [...] } — the two-queue board.
function queues() {
  const db = getDb();
  const review = db.prepare(
    `${STATE_SELECT} WHERE s.fsm_state IN (${_placeholders(REVIEW_QUEUE_STATES)})
     ORDER BY s.stall_age_hours DESC, s.pr_id DESC`).all(...REVIEW_QUEUE_STATES);
  const fix = db.prepare(
    `${STATE_SELECT} WHERE s.fsm_state IN (${_placeholders(FIX_QUEUE_STATES)})
     ORDER BY s.worker_slot ASC, s.pr_id DESC`).all(...FIX_QUEUE_STATES);
  return { review, fix };
}

// Active takeover workers, keyed by slot.
function takeoverWorkers() {
  const db = getDb();
  return db.prepare(
    `${STATE_SELECT} WHERE s.fsm_state IN (${_placeholders(TAKEOVER_ACTIVE)})
     ORDER BY s.worker_slot ASC`).all(...TAKEOVER_ACTIVE);
}

// PRs grouped by linked issue with their dedup verdict (winner / losers).
function issueGroups() {
  const db = getDb();
  const rows = db.prepare(
    `${STATE_SELECT} WHERE s.linked_issue IS NOT NULL ORDER BY s.linked_issue, s.pr_id`).all();
  const groups = {};
  for (const r of rows) (groups[r.linked_issue] ||= []).push(r);
  return Object.entries(groups)
    .filter(([, prs]) => prs.length > 1)
    .map(([issue, prs]) => ({ issue: Number(issue), prs }));
}

function fsmCounts() {
  const db = getDb();
  return db.prepare(`SELECT fsm_state, COUNT(*) n FROM pr_state GROUP BY fsm_state`)
    .all().reduce((m, r) => (m[r.fsm_state] = r.n, m), {});
}

// Drop pr_state rows whose state file no longer exists (keepIds = the PR
// numbers currently present in state/). Keeps the board from showing PRs that
// were ejected/removed on disk.
function pruneStateExcept(keepIds) {
  const db = getDb();
  const keep = new Set((keepIds || []).map(Number));
  const have = db.prepare('SELECT pr_id FROM pr_state').all().map((r) => r.pr_id);
  const del = db.prepare('DELETE FROM pr_state WHERE pr_id = ?');
  let n = 0;
  for (const id of have) if (!keep.has(id)) { del.run(id); n++; }
  return n;
}

function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  getDb,
  upsertPr,
  upsertPrGithub,
  upsertPrState,
  queues,
  takeoverWorkers,
  issueGroups,
  fsmCounts,
  pruneStateExcept,
  REVIEW_QUEUE_STATES,
  FIX_QUEUE_STATES,
  getAllPrs,
  getPrById,
  getPrByIdFull,
  getStats,
  replaceCyclesForPr,
  getCyclesByPr,
  insertCronRun,
  getAllCronRuns,
  getPrsWithLatestCycle,
  queryPrs,
  getFilterOptions,
  updatePrStatus,
  updatePrTrackingPath,
  markPrNotOpen,
  markClosedPrs,
  close,
};
