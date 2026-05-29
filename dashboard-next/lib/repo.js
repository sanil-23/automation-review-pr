// The repo the dashboard operates on — read from the repo-root .env
// (REVIEW_REPO), the single source of truth set via the Setup wizard.
const { readEnv } = require('./envfile');

function reviewRepo() {
  try { return (readEnv().REVIEW_REPO || '').trim() || 'tinyhumansai/openhuman'; }
  catch { return 'tinyhumansai/openhuman'; }
}

module.exports = { reviewRepo };
