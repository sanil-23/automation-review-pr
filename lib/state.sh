#!/usr/bin/env bash
# lib/state.sh — per-PR FSM state store + GitHub state-signature engine.
#
# Source this from the cron scripts. It owns one JSON file per PR under
# $STATE_DIR (state/pr-<N>.json) and the "has this PR changed since we last
# reviewed it?" signature logic that gates Cron 2.
#
# Requires: gh, jq. Reads REVIEW_REPO, ME, STATE_DIR, STALL_HOURS from env.

# --- config defaults (callers normally export these from .env) ---------------
: "${REVIEW_REPO:=tinyhumansai/openhuman}"
: "${ME:=graycyrus}"
: "${STATE_DIR:=state}"
: "${STALL_HOURS:=24}"

# Valid FSM states. Cron 3 OWNS everything from QUEUED_FOR_FIX onward; Cron 2
# must never touch those.
STATE_TAKEOVER_OWNED="QUEUED_FOR_FIX FIXING AWAIT_CI READY_MERGE"
# DISMISSED = manually ejected from a queue via the dashboard; crons ignore it.
STATE_TERMINAL="MERGED CLOSED_LOSER CLOSED_REDUNDANT CLOSED DISMISSED"

# --- small helpers ------------------------------------------------------------
_now()   { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
_epoch() { date +%s; }

# epoch for an ISO-8601 timestamp (GNU date). Empty/invalid -> 0.
iso_epoch() {
  local ts="$1"
  [ -z "$ts" ] && { echo 0; return; }
  date -u -d "$ts" +%s 2>/dev/null || echo 0
}

state_dir_ensure() { mkdir -p "$STATE_DIR"; }
state_file()       { echo "${STATE_DIR}/pr-$1.json"; }
state_exists()     { [ -f "$(state_file "$1")" ]; }

# state_get <pr> <jq-path>   e.g. state_get 12 .fsm_state
state_get() {
  local f; f="$(state_file "$1")"
  [ -f "$f" ] || { echo ""; return; }
  jq -r "${2} // empty" "$f" 2>/dev/null || echo ""
}

# Initialise a skeleton state file if absent.
state_init() {
  local pr="$1"
  state_dir_ensure
  local f; f="$(state_file "$pr")"
  [ -f "$f" ] && return 0
  jq -n --argjson pr "$pr" --arg repo "$REVIEW_REPO" --arg now "$(_now)" '{
    pr: $pr, repo: $repo,
    title: null, url: null, author: null,
    is_me_author: false, assignee_me: false, linked_issue: null,
    head_sha: null, fsm_state: "NEW", queue: "review",
    signature: null, last_reviewed_signature: null, last_review_at: null,
    review_decision: null, ci_state: null, coderabbit_approved: false,
    findings: {critical:0, major:0, minor:0},
    winner_pr: null, dedup_verdict: null,
    last_author_activity_at: null, stall_age_hours: 0, queued_for_fix_at: null,
    fix_phase: null, worker_slot: null, takeover_started_at: null, last_error: null,
    history: [{at:$now, state:"NEW", note:"discovered"}],
    created_at: $now, updated_at: $now
  }' > "$f"
}

# Atomic write of a jq program against the state file.
# _state_apply <pr> <jq-program> [jq-args...]
_state_apply() {
  local pr="$1"; shift
  local prog="$1"; shift
  local f; f="$(state_file "$pr")"
  [ -f "$f" ] || state_init "$pr"
  local tmp="${f}.tmp.$$"
  if jq "$@" "$prog | .updated_at = \"$(_now)\"" "$f" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$f"
  else
    rm -f "$tmp"; return 1
  fi
}

# state_set <pr> <key> <string-value>
state_set()     { _state_apply "$1" ".${2} = \$v" --arg v "$3"; }
# state_set_json <pr> <key> <raw-json>   (numbers, bools, null, arrays)
state_set_json() { _state_apply "$1" ".${2} = \$v" --argjson v "$3"; }

# fsm_set <pr> <STATE> [note]  — sets fsm_state, queue, and appends history.
fsm_set() {
  local pr="$1" st="$2" note="${3:-}"
  local q="review"
  case " $STATE_TAKEOVER_OWNED " in *" $st "*) q="fix";; esac
  case " $STATE_TERMINAL " in *" $st "*) q="none";; esac
  _state_apply "$pr" \
    '.fsm_state=$s | .queue=$q | .history += [{at:$now, state:$s, note:$n}]' \
    --arg s "$st" --arg q "$q" --arg n "$note" --arg now "$(_now)"
}

# True if Cron 3 owns this PR (Cron 2 must skip it).
state_owned_by_takeover() {
  local st; st="$(state_get "$1" .fsm_state)"
  case " $STATE_TAKEOVER_OWNED " in *" $st "*) return 0;; esac
  return 1
}
state_is_terminal() {
  local st; st="$(state_get "$1" .fsm_state)"
  case " $STATE_TERMINAL " in *" $st "*) return 0;; esac
  return 1
}

# List PR numbers whose fsm_state is in the given set. Usage: state_list_fsm IN_REVIEW CHANGES_REQUESTED
state_list_fsm() {
  state_dir_ensure
  local want=" $* "
  local f st pr
  for f in "$STATE_DIR"/pr-*.json; do
    [ -e "$f" ] || continue
    st="$(jq -r '.fsm_state // empty' "$f" 2>/dev/null)"
    case "$want" in *" $st "*)
      pr="$(jq -r '.pr' "$f" 2>/dev/null)"; [ -n "$pr" ] && echo "$pr";;
    esac
  done
}

# --- GitHub snapshot + signature ---------------------------------------------
# One compact gh call holding everything the system needs about a PR.
pr_snapshot() {
  gh pr view "$1" -R "$REVIEW_REPO" --json \
number,title,url,author,assignees,labels,body,isDraft,state,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,updatedAt,reviewDecision,mergeable,mergeStateStatus,comments,reviews,statusCheckRollup \
    2>/dev/null
}

# signature_of <snapshot-json> — hash of the fields that mean "needs re-review":
# head sha + last-update + comment/review counts + review decision + CI rollup.
signature_of() {
  jq -r '[
    (.headRefOid // ""),
    (.updatedAt // ""),
    (.comments | length),
    (.reviews  | length),
    (.reviewDecision // "NONE"),
    ([.statusCheckRollup[]? | (.conclusion // .state // "")] | sort | join(","))
  ] | join("|")' <<<"$1" 2>/dev/null | sha1sum | cut -d' ' -f1
}

# coderabbit_approved <snapshot-json> — latest CodeRabbit review is APPROVED.
coderabbit_approved() {
  jq -e '[.reviews[]? | select(.author.login=="coderabbitai[bot]")] | last | .state=="APPROVED"' \
    <<<"$1" >/dev/null 2>&1
}

# ci_rollup_state <snapshot-json> — SUCCESS / FAILURE / PENDING / NONE
ci_rollup_state() {
  jq -r '
    [.statusCheckRollup[]? | (.conclusion // .state // "")] as $c
    | if ($c|length)==0 then "NONE"
      elif ($c|map(ascii_upcase) | any(.=="FAILURE" or .=="ERROR" or .=="CANCELLED" or .=="TIMED_OUT")) then "FAILURE"
      elif ($c|map(ascii_upcase) | any(.=="PENDING" or .=="" or .=="EXPECTED" or .=="IN_PROGRESS" or .=="QUEUED")) then "PENDING"
      else "SUCCESS" end' <<<"$1" 2>/dev/null || echo NONE
}

# signature_changed <pr> — true if current signature differs from the one we
# recorded at the last review. Drives Cron 2's "only review if changed" rule.
signature_changed() {
  local pr="$1" snap cur last
  snap="$(pr_snapshot "$pr")"
  cur="$(signature_of "$snap")"
  last="$(state_get "$pr" .last_reviewed_signature)"
  state_set "$pr" signature "$cur"
  [ "$cur" != "$last" ]
}

# reconcile_terminal <pr> — if the PR is no longer OPEN on GitHub, move it to a
# terminal state (MERGED / CLOSED) so it drops out of the queue, and return 0
# (caller should skip it). Returns 1 if it's still open.
reconcile_terminal() {
  local pr="$1" st
  st="$(gh pr view "$pr" -R "$REVIEW_REPO" --json state --jq '.state' 2>/dev/null)"
  case "$st" in
    MERGED) fsm_set "$pr" MERGED "merged on GitHub — removed from queue"; return 0 ;;
    CLOSED) fsm_set "$pr" CLOSED "closed on GitHub — removed from queue"; return 0 ;;
  esac
  return 1
}

# author_last_activity <pr> <author> — ISO ts of the author's most recent
# action on the PR (commit, issue comment, review, or review comment). Empty
# if none. Used by Cron 3 to measure author silence.
author_last_activity() {
  local pr="$1" author="$2" max="" t
  # latest commit authored/committed by them
  t=$(gh pr view "$pr" -R "$REVIEW_REPO" --json commits \
       --jq "[.commits[] | select((.authors[]?.login // \"\")==\"$author\") | .committedDate] | max // empty" 2>/dev/null)
  [ -n "$t" ] && [ "$(iso_epoch "$t")" -gt "$(iso_epoch "$max")" ] && max="$t"
  # latest issue comment by them
  t=$(gh api "repos/$REVIEW_REPO/issues/$pr/comments" --paginate \
       --jq "[.[] | select(.user.login==\"$author\") | .created_at] | max // empty" 2>/dev/null)
  [ -n "$t" ] && [ "$(iso_epoch "$t")" -gt "$(iso_epoch "$max")" ] && max="$t"
  # latest review by them
  t=$(gh api "repos/$REVIEW_REPO/pulls/$pr/reviews" --paginate \
       --jq "[.[] | select(.user.login==\"$author\") | .submitted_at] | max // empty" 2>/dev/null)
  [ -n "$t" ] && [ "$(iso_epoch "$t")" -gt "$(iso_epoch "$max")" ] && max="$t"
  # latest review (inline) comment by them
  t=$(gh api "repos/$REVIEW_REPO/pulls/$pr/comments" --paginate \
       --jq "[.[] | select(.user.login==\"$author\") | .created_at] | max // empty" 2>/dev/null)
  [ -n "$t" ] && [ "$(iso_epoch "$t")" -gt "$(iso_epoch "$max")" ] && max="$t"
  echo "$max"
}

# stall_hours_for <pr> <author> — whole hours since the author's last activity
# (falls back to PR creation if they've never acted). Echoes an integer.
stall_hours_for() {
  local pr="$1" author="$2" last
  last="$(author_last_activity "$pr" "$author")"
  if [ -z "$last" ]; then
    last="$(gh pr view "$pr" -R "$REVIEW_REPO" --json createdAt --jq .createdAt 2>/dev/null)"
  fi
  local le; le="$(iso_epoch "$last")"
  [ "$le" -eq 0 ] && { echo 0; return; }
  echo $(( ( $(_epoch) - le ) / 3600 ))
}
