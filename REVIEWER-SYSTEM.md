# PR Reviewer + Autonomous Takeover

A 3-cron system that reviews PRs involving you and, when an author goes silent,
takes the PR over, fixes it, gets CI + CodeRabbit green, and merges it.

Identity = `$ME` (sanil-23). Target = `$REVIEW_REPO`. Config in `.env`
(template in `.env.example`). Flow diagram: `docs/pr-reviewer-flow.excalidraw`.

## The three crons

| Cron | Script | Schedule | Job |
|------|--------|----------|-----|
| 1 | `bin/scout-assign` | every 20m | Discover in-scope PRs (mention / review-request / assignee `$ME`, plus others' PRs that link an issue), assign `@me`, dedup by linked issue (judge a **winner**, auto-close losers / already-merged redundants), enqueue survivors → **REVIEW QUEUE** (`IN_REVIEW`). |
| 2 | `bin/review-cron` | every 30m | **Review only.** Drain the review queue; for each PR whose GitHub `state_signature` changed since last time, run `review-single.sh` (posts as `$ME`) and record the new signature. Never fixes. Skips PRs Cron 3 owns. |
| 3 | `bin/stall-watch` | hourly | Measure author silence on review-queue PRs. At `STALL_HOURS` (24h) move → **FIX QUEUE** (`QUEUED_FOR_FIX`), then dispatch `bin/takeover`. |

`bin/takeover` drains the fix queue **`TAKEOVER_CONCURRENCY` (5) at a time**,
launching `bin/takeover-worker` per PR. Each worker:
`FIXING` (`pnpm review fix`) → `coverage` → `AWAIT_CI` (poll until required CI
green **and** CodeRabbit `APPROVED`) → `READY_MERGE` → `merge --admin` →
`MERGED`. Landing: pushes to the author branch if maintainer-edits are allowed,
else opens a **replacement PR** from `$REVIEW_REPO` that `Closes` the issue.

The takeover engine is the vendored openhuman toolkit in `vendor/review/`
(`cli.sh fix|coverage|merge`), driven by `claude --dangerously-skip-permissions`.

## State machine

`state/pr-<N>.json` (one file per PR) is the source of truth. States:
`NEW → IN_REVIEW → {CHANGES_REQUESTED|CLEAN}` (review queue) and
`QUEUED_FOR_FIX → FIXING → AWAIT_CI → READY_MERGE → MERGED` (fix queue), plus
`WINNER / CLOSED_LOSER / CLOSED_REDUNDANT`. `lib/state.sh` owns reads/writes,
the `state_signature` (the "changed since last review?" gate), and stall math.
Cron 2 owns the review-queue states; Cron 3 owns everything from
`QUEUED_FOR_FIX` on — the state acts as the hand-off lock so they never fight.

## Run it — one app

The dashboard server **is** the backend: it runs an in-process cron scheduler
(`dashboard-next/lib/scheduler.js`, started from `instrumentation.node.ts`) that
fires the 3 crons on their `cron-config.json` schedule. So a single command runs
the whole system — UI **and** crons:

```bash
bin/dashboard-next          # UI on :3848 + in-process crons + gh/git preflight
```

First load shows a **Setup wizard** (set the target repo / identity) if
`REVIEW_REPO` isn't configured; otherwise use the `⚙` gear to change it. The
**Cron schedule** panel edits intervals live (no restart), toggles the loop, and
has per-job **Run now**. Removing a PR from a queue / cancelling a takeover is the
`×` on any queue row or worker slot.

```bash
cp .env.example .env        # initial config (or use the Setup wizard)
bin/run-cycle               # run all 3 crons once, now (CLI, for testing)
```

### Headless (no dashboard) — optional OS crontab

If you want the crons to run without the dashboard process up, install them into
the OS crontab instead (the in-process scheduler and crontab are interchangeable;
flock guards prevent double-runs if both are active):

```bash
bin/cron-install            # install the 3 schedules into crontab (reads cron-config.json)
bin/cron-status             # crons + queue snapshot + log tails
bin/cron-uninstall          # remove them
```

## Dashboard

`dashboard-next/` ingests `state/` into a `pr_state` SQLite table
(`lib/state-sync.js`, which also prunes rows whose state file was removed) and
shows:
- **SetupWizard** — first-run / `⚙` modal to set the target repo + identity (writes `.env`).
- **CronControl** — edit the 3 cron schedules live, enable/disable the loop, Run-now per job.
- **TakeoverPanel** — the 5 worker slots with phase (`fix→coverage→merge`), CI/CodeRabbit status, elapsed time, live tmux window, and a cancel `×`.
- **QueueBoard** — the REVIEW ↔ FIX two-queue board + duplicate-issue groups, with a per-row eject `×`.
- **IdentityBanner** — red banner if `gh`/`git`/`ME` disagree.

APIs: `GET /api/queues`, `GET /api/takeover`, `GET/POST /api/cron-config`,
`POST /api/cron-run`, `POST /api/queue/eject`, `GET/POST /api/setup`,
`GET /api/identity-check`. Repo target resolves from `.env` via `lib/repo.js`.

## Autonomy / safety

`AUTONOMY=full` auto-closes losing dup PRs and auto-merges winners with
`merge --admin` (safe only because `$REVIEW_REPO` is your own repo). Set
`AUTONOMY=manual` to stop before any close/merge and leave them for confirmation.
