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

export PATH="/Users/cyrus/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"

echo "=== Reviewing PR #${PR} ==="
echo ""

# Git: pull latest (skip if called from cron)
if [ -z "${CRON_MODE:-}" ]; then
    echo "[Git] Pulling latest changes..."
    cd "${SCRIPT_DIR}"
    git pull --rebase origin main
    echo ""
fi

echo "[Phase A] Gathering intelligence..."
claude -p "$(sed "s/__PR_NUMBER__/${PR}/g" "${INTEL_PROMPT}")" \
    --allowedTools "Bash,Read,Write" \
    --add-dir "${REPO_DIR}"

echo ""
echo "[Phase B] Deep review + posting..."
claude -p "$(sed "s/__PR_NUMBER__/${PR}/g" "${REVIEW_PROMPT}")" \
    --allowedTools "Bash,Read,Write" \
    --add-dir "${REPO_DIR}"

# Git: commit, pull, push (skip if called from cron)
if [ -z "${CRON_MODE:-}" ]; then
    echo ""
    echo "[Git] Committing and pushing review outputs..."
    cd "${SCRIPT_DIR}"
    git add -A
    git commit -m "Review PR #${PR}" || echo "Nothing to commit"
    git pull --rebase origin main
    git push origin main
fi

echo ""
echo "=== Done ==="
