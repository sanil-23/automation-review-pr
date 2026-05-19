# Merge Button

## Overview

The Merge button appears on the PR detail page and table for PRs that are approved (by us via the Approve button, or by anyone on GitHub). It calls the existing merge script from the target repo which handles all pre-merge gates, commit message formatting, and squash merge execution.

## Eligibility

Merge button is visible when:
- PR status is `approved` (approved via dashboard), OR
- PR `review_decision` is `APPROVED` (approved by anyone on GitHub)
- AND the PR is not currently running a review/merge

## Flow

1. User clicks "Merge" on an eligible PR
2. Backend spawns the merge script as a background job:
   ```bash
   bash scripts/shortcuts/review/merge.sh <PR> --squash --summary-llm none
   ```
3. Live output streams to the dashboard (same as review live logs)
4. The merge script runs 8 pre-merge gate checks:
   - Not a draft
   - CI passing
   - No merge conflicts
   - All review threads resolved
   - At least one APPROVED review
   - No pending change requests
   - Coverage gate passed
   - PR description has required sections
5. If all gates pass: squash merge with `--delete-branch`
6. On success: DB updated to `merged`, tracking file moved to `already-merged/`

## API

```
POST /api/trigger/merge/:id
```

**Success response** (200):
```json
{
  "jobId": "merge-2080",
  "pr": 2080,
  "pid": 12345,
  "logFile": "logs/merge-PR-2080-2026-05-19T13-00-00.log",
  "message": "Merge started for PR #2080"
}
```

Live log polling via `GET /api/trigger/log/merge-2080?after=0` (same as review logs).

## Gate Failures

If any pre-merge check fails, the merge script exits with code 1. The failure reason is visible in the live log output. PR status remains unchanged.
