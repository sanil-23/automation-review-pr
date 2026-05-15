#!/bin/bash
# Review a single PR — runs Phase A (intelligence) then Phase B (review + post)
# Usage: ./review-single.sh <PR_NUMBER>

set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "Usage: ./review-single.sh <PR_NUMBER>"
    exit 1
fi

PR="$1"
SCRIPT_DIR="/Users/cyrus/Desktop/automation/review-pr"
REPO_DIR="/Users/cyrus/Desktop/Code/tinyhuman/openhuman.ai/openhuman"
INTEL_PROMPT="${SCRIPT_DIR}/phase-a-intelligence-prompt.md"
REVIEW_PROMPT="${SCRIPT_DIR}/phase-b-review-prompt.md"
STATUS_FILE="${SCRIPT_DIR}/status.json"

export PATH="/Users/cyrus/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"

REVIEW_START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Write status on failure
cleanup_status() {
    local exit_code=$?
    REVIEW_END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    if [ ${exit_code} -ne 0 ]; then
        echo "{\"pr\":${PR},\"running\":false,\"failed\":true,\"started\":\"${REVIEW_START}\",\"ended\":\"${REVIEW_END}\"}" > "${STATUS_FILE}"
    fi
}
trap cleanup_status EXIT

echo "=== Reviewing PR #${PR} ==="
echo "REVIEW_STARTED=${REVIEW_START}"
echo ""

# Git: pull latest (skip if called from cron or dashboard trigger)
if [ -z "${CRON_MODE:-}" ] && [ -z "${DASHBOARD_MODE:-}" ]; then
    echo "[Git] Pulling latest changes..."
    cd "${SCRIPT_DIR}"
    git stash --quiet 2>/dev/null || true
    git pull --rebase origin main || echo "[Git] Pull failed, continuing anyway"
    git stash pop --quiet 2>/dev/null || true
    echo ""
fi

echo "{\"pr\":${PR},\"phase\":\"A\",\"running\":true,\"started\":\"${REVIEW_START}\"}" > "${STATUS_FILE}"

echo "[Phase A] Gathering intelligence..."
claude -p "$(sed "s/__PR_NUMBER__/${PR}/g" "${INTEL_PROMPT}")" \
    --allowedTools "Bash,Read,Write" \
    --add-dir "${REPO_DIR}"

echo "{\"pr\":${PR},\"phase\":\"B\",\"running\":true,\"started\":\"${REVIEW_START}\"}" > "${STATUS_FILE}"

echo ""
echo "[Phase B] Deep review + posting..."
claude -p "$(sed "s/__PR_NUMBER__/${PR}/g" "${REVIEW_PROMPT}")" \
    --allowedTools "Bash,Read,Write" \
    --add-dir "${REPO_DIR}"

REVIEW_END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"pr\":${PR},\"running\":false,\"started\":\"${REVIEW_START}\",\"ended\":\"${REVIEW_END}\"}" > "${STATUS_FILE}"
echo "REVIEW_ENDED=${REVIEW_END}"

# Git: commit, pull, push (skip if called from cron)
if [ -z "${CRON_MODE:-}" ]; then
    echo ""
    echo "[Git] Committing and pushing review outputs..."
    cd "${SCRIPT_DIR}"
    git add tinyhumansai-openhuman/ to-be-approved/ 2>/dev/null || true
    git commit -m "Review PR #${PR}" || echo "Nothing to commit"
    git stash --quiet 2>/dev/null || true
    git pull --rebase origin main || echo "[Git] Pull failed, continuing anyway"
    git stash pop --quiet 2>/dev/null || true
    git push origin main || echo "[Git] Push failed"
fi

echo ""
echo "=== Done ==="
