// The repo the dashboard operates on — read from the repo-root config.toml
// (review_repo), the single source of truth set via the Setup wizard.
const { readConfig } = require('./config');

function reviewRepo() {
  try { return String(readConfig().review_repo || '').trim() || 'tinyhumansai/openhuman'; }
  catch { return 'tinyhumansai/openhuman'; }
}

module.exports = { reviewRepo };
