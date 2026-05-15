# PR Review Automation

Automated code reviewer for [tinyhumansai/openhuman](https://github.com/tinyhumansai/openhuman). Discovers open PRs, reviews them using Claude CLI, posts structured reviews to GitHub, and tracks everything locally. Includes a local web dashboard for monitoring and managing reviews.

## How it works

```
Cron (hourly)
  -> discover-prompt.md    Find eligible PRs (non-draft, CI passing, no conflicts)
  -> review-single.sh      Per PR:
       -> Phase A           Intelligence gathering (read PR, diff, sibling code, dedup CodeRabbit)
       -> Phase B           Deep review + post to GitHub as REQUEST_CHANGES or COMMENT
       -> PR-<N>.md         Track findings, status, review history locally
```

Reviews are posted as `graycyrus` (Cyrus Grey). Clean PRs (zero critical/major findings) are moved to `to-be-approved/` for manual approval. PRs are never auto-approved or merged.

## Dashboard

Local web UI at `http://localhost:3847` built with Express + SQLite.

### Features

- All open PRs from GitHub with full metadata (diff stats, merge status, labels, reviewers, assignees)
- Insider/outsider detection via org membership
- Review timeline per PR with cycle details, findings, and links to GitHub reviews
- Rendered tracking files and raw logs
- Manual review triggers (single PR or full discovery)
- Server-side query-based filters synced to URL params
- Live progress indicator when a review is running
- Auto-syncs via `fs.watch()` on tracking files + GitHub API every 5 min

### Filters

Everything is filterable and combinable:

| Filter | Options |
|--------|---------|
| Search | Free text (PR #, title, author, label) |
| Status | pending, clean, changes-requested, blocked, under-review |
| Author | All contributors (auto-populated) |
| Insider/Outsider | Org member or external contributor |
| Draft/Ready | Draft PRs or ready for review |
| Mergeable | Mergeable, conflicts, unknown |
| GH Review Decision | Approved, changes requested, none |
| Reviewed | Has been reviewed by this system or not |
| Has Findings | Has critical/major/minor findings or clean |
| Merge State | BLOCKED, DIRTY, etc. |
| Labels | Auto-populated from GitHub |
| Sort | PR #, updated, created, additions, deletions, cycles, findings, author |
| Order | Ascending or descending |

Default view: **Ready only + Mergeable**. Filters persist in the URL — bookmarkable and shareable.

### Running the dashboard

```bash
cd dashboard
npm install
node server.js
# -> http://localhost:3847
```

Or use the launcher:

```bash
cd dashboard && ./start.sh
```

## Scripts

### `cron-pr-review.sh`

Hourly cron job. Discovers eligible PRs, reviews them in parallel, commits and pushes tracking files.

```bash
# Crontab entry
0 * * * * /Users/cyrus/Desktop/automation/review-pr/cron-pr-review.sh
```

### `review-single.sh`

Review a single PR manually.

```bash
./review-single.sh 1804
```

Writes `status.json` with live progress (Phase A/B) for the dashboard to pick up.

## Directory structure

```
review-pr/
├── cron-pr-review.sh              # Hourly cron — discover + review
├── review-single.sh               # Single PR review (Phase A + B)
├── discover-prompt.md             # Prompt: find eligible PRs
├── phase-a-intelligence-prompt.md # Prompt: gather context
├── phase-b-review-prompt.md       # Prompt: review + post
├── tinyhumansai-openhuman/        # Tracking files (under review)
│   └── PR-<N>.md
├── to-be-approved/                # Clean PRs awaiting manual approval
│   └── PR-<N>.md
├── logs/                          # Review logs
├── status.json                    # Live review status
├── dashboard/                     # Web dashboard
│   ├── server.js                  # Express server
│   ├── db.js                      # SQLite schema + query builder
│   ├── parser.js                  # .md tracking file parser
│   ├── migrate.js                 # Seed DB from existing files
│   ├── sync.js                    # fs.watch() file sync
│   ├── github-sync.js             # GitHub API sync (every 5 min)
│   ├── routes/api.js              # REST API with query-based filters
│   ├── routes/trigger.js          # Manual trigger endpoints
│   └── public/                    # Frontend (vanilla HTML/CSS/JS)
└── CLAUDE.md                      # Project docs for Claude sessions
```

## Data architecture

Single SQLite database (`dashboard/data/reviews.db`):

- **`prs`** — core table for all PRs (from both tracking files and GitHub)
- **`pr_github`** — 1:1 extension with GitHub metadata (diff, mergeable, labels, etc.)
- **`review_cycles`** — 1:many review history per PR (from tracking .md files)
- **`cron_runs`** — cron execution history

Both sources merge into `prs` via `ON CONFLICT` upsert. Tracking `.md` files remain the source of truth for review data.

## Requirements

- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) — runs the review prompts
- [GitHub CLI](https://cli.github.com/) (`gh`) — API access, authenticated
- Node.js v22+ — dashboard server
