// Read/patch the repo-root .env (the single source of truth the cron scripts
// and vendored `pnpm review` fixes source at runtime). Comment/blank lines and
// untouched keys are preserved on write.
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(path.resolve(process.cwd(), '..'), '.env');

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function readEnv() {
  const out = {};
  let raw = '';
  try { raw = fs.readFileSync(ENV_PATH, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = unquote(m[2]);
  }
  return out;
}

// Update-or-append the given keys, preserving everything else verbatim.
function writeEnv(updates) {
  let lines = [];
  try { lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n'); } catch { lines = []; }
  const remaining = { ...updates };
  const patched = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(remaining, m[1])) {
      const k = m[1]; const v = remaining[k]; delete remaining[k];
      return `${k}=${v}`;
    }
    return line;
  });
  const appends = Object.entries(remaining).map(([k, v]) => `${k}=${v}`);
  let body = patched.join('\n');
  if (appends.length) body = body.replace(/\n*$/, '\n') + appends.join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, body);
  return readEnv();
}

module.exports = { readEnv, writeEnv, ENV_PATH };
