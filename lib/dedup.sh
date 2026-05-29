#!/usr/bin/env bash
# lib/dedup.sh — linked-issue grouping, winner selection, loser closing.
#
# Sourced by bin/scout-assign. Depends on lib/state.sh being sourced first
# (for pr_snapshot / ci_rollup_state / coderabbit_approved) and on gh + jq.
#
# Reads: REVIEW_REPO, ME, AUTONOMY, MODEL_JUDGE.

: "${AUTONOMY:=full}"
: "${MODEL_JUDGE:=haiku}"

# linked_issue_of <pr> — the issue this PR closes. Prefers GitHub's own
# closing-reference graph; falls back to a Closes/Fixes/Resolves #N body scan.
linked_issue_of() {
  local pr="$1" iss
  iss=$(gh pr view "$pr" -R "$REVIEW_REPO" --json closingIssuesReferences \
        --jq '.closingIssuesReferences[0].number // empty' 2>/dev/null)
  if [ -z "$iss" ]; then
    iss=$(gh pr view "$pr" -R "$REVIEW_REPO" --json body --jq '.body // ""' 2>/dev/null \
          | grep -oiE '(close[sd]?|fixe?[sd]?|resolve[sd]?)[[:space:]]*#[0-9]+' \
          | grep -oE '[0-9]+' | head -1)
  fi
  echo "$iss"
}

# prs_for_issue <issue> — every PR connected/cross-referenced to the issue.
# Echoes "number<TAB>state" lines (state = OPEN | MERGED | CLOSED).
prs_for_issue() {
  local issue="$1" owner name
  owner="${REVIEW_REPO%%/*}"; name="${REVIEW_REPO##*/}"
  gh api graphql -f owner="$owner" -f name="$name" -F num="$issue" -f query='
    query($owner:String!,$name:String!,$num:Int!){
      repository(owner:$owner,name:$name){
        issue(number:$num){
          timelineItems(first:100, itemTypes:[CONNECTED_EVENT,CROSS_REFERENCED_EVENT]){
            nodes{
              __typename
              ... on ConnectedEvent     { subject{ __typename ... on PullRequest{ number state } } }
              ... on CrossReferencedEvent{ source { __typename ... on PullRequest{ number state } } }
            }
          }
        }
      }
    }' 2>/dev/null \
  | jq -r '
      [ .data.repository.issue.timelineItems.nodes[]?
        | (.subject // .source)
        | select(.__typename=="PullRequest")
        | {number, state} ]
      | unique_by(.number)[]
      | "\(.number)\t\(.state)"' 2>/dev/null
}

# _pr_scoreline <pr> — compact one-line summary used to brief the judge.
_pr_scoreline() {
  local pr="$1" snap
  snap="$(pr_snapshot "$pr")"
  local ci dec cr add del files author created
  ci="$(ci_rollup_state "$snap")"
  dec="$(jq -r '.reviewDecision // "NONE"' <<<"$snap")"
  coderabbit_approved "$snap" && cr="yes" || cr="no"
  add="$(gh pr view "$pr" -R "$REVIEW_REPO" --json additions,deletions,changedFiles,author,createdAt 2>/dev/null)"
  files="$(jq -r '.changedFiles' <<<"$add")"
  del="$(jq -r '.deletions' <<<"$add")"
  author="$(jq -r '.author.login' <<<"$add")"
  created="$(jq -r '.createdAt' <<<"$add")"
  local plus; plus="$(jq -r '.additions' <<<"$add")"
  printf 'PR #%s | author:%s | CI:%s | reviewDecision:%s | coderabbitApproved:%s | +%s/-%s in %s files | opened:%s\n' \
    "$pr" "$author" "$ci" "$dec" "$cr" "$plus" "$del" "$files" "$created"
}

# _heuristic_winner <pr...> — deterministic fallback ranking.
# Rank by: CI SUCCESS > CodeRabbit-approved > APPROVED decision > smaller diff
# > most recent. Echoes the winning PR number.
_heuristic_winner() {
  local best="" best_score=-1 pr snap score
  for pr in "$@"; do
    snap="$(pr_snapshot "$pr")"
    score=0
    [ "$(ci_rollup_state "$snap")" = "SUCCESS" ] && score=$((score+100))
    coderabbit_approved "$snap" && score=$((score+40))
    [ "$(jq -r '.reviewDecision//"NONE"' <<<"$snap")" = "APPROVED" ] && score=$((score+20))
    # recency tiebreak: newer updatedAt adds a small amount
    local up; up="$(iso_epoch "$(jq -r '.updatedAt//""' <<<"$snap")")"
    score=$((score + up/100000000))
    if [ "$score" -gt "$best_score" ]; then best_score=$score; best=$pr; fi
  done
  echo "$best"
}

# judge_winner <issue> <pr...> — pick the PR to keep. Tries claude -p; on any
# failure falls back to the deterministic heuristic. Echoes the winner number.
judge_winner() {
  local issue="$1"; shift
  local prs=("$@")
  [ "${#prs[@]}" -le 1 ] && { echo "${prs[0]:-}"; return; }

  local brief="" pr
  for pr in "${prs[@]}"; do brief+="$(_pr_scoreline "$pr")"$'\n'; done

  local winner=""
  if command -v claude >/dev/null 2>&1; then
    local prompt="You are choosing ONE winning pull request to keep open for issue #${issue} on ${REVIEW_REPO}. The others will be closed as duplicates. Prefer: green CI, CodeRabbit approval, an APPROVED review, smaller focused diffs, and the most complete solution. Candidates:

${brief}

Reply with ONLY the winning PR number (digits only), nothing else."
    winner=$(claude -p "$prompt" --model "${MODEL_JUDGE}" --max-budget-usd 0.05 2>/dev/null \
             | grep -oE '[0-9]+' | head -1)
  fi
  # Validate the judge picked one of the candidates; else heuristic.
  local ok=""
  for pr in "${prs[@]}"; do [ "$pr" = "$winner" ] && ok=1; done
  [ -z "$ok" ] && winner="$(_heuristic_winner "${prs[@]}")"
  echo "$winner"
}

# close_loser <pr> <winner> <kind>  kind = duplicate | redundant
# Posts a comment + closes the PR. Honours AUTONOMY: if not "full", only marks
# the state and leaves the PR open for manual confirmation.
close_loser() {
  local pr="$1" winner="$2" kind="${3:-duplicate}"
  local fsm reason
  if [ "$kind" = "redundant" ]; then
    fsm="CLOSED_REDUNDANT"
    reason="The issue this PR addresses is already resolved by a merged PR (#${winner}). Closing as redundant — thanks for the contribution!"
  else
    fsm="CLOSED_LOSER"
    reason="Closing in favor of #${winner}, which was selected as the primary fix for this issue (better CI/review state). Thanks for the contribution — please coordinate on #${winner}."
  fi
  state_init "$pr"
  state_set_json "$pr" winner_pr "$winner"
  state_set "$pr" dedup_verdict "$kind:superseded-by-#${winner}"

  if [ "$AUTONOMY" = "full" ]; then
    gh pr comment "$pr" -R "$REVIEW_REPO" --body "$reason" >/dev/null 2>&1 || true
    gh pr close "$pr" -R "$REVIEW_REPO" >/dev/null 2>&1 || true
    fsm_set "$pr" "$fsm" "auto-closed; superseded by #${winner}"
    echo "[dedup] closed #${pr} ($kind) -> winner #${winner}"
  else
    fsm_set "$pr" "$fsm" "PENDING manual close; superseded by #${winner} (AUTONOMY!=full)"
    echo "[dedup] flagged #${pr} for manual close ($kind) -> winner #${winner}"
  fi
}
