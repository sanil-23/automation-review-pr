// Read/patch the repo-root config.toml (the single source of truth the cron
// scripts and pnpm fixes also read). Flat TOML only — `[section]` headers are
// ignored. Comments, blank lines, and untouched keys are preserved on write.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(path.resolve(process.cwd(), '..'), 'config.toml');

function coerce(v) {
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function readConfig() {
  const out = {};
  let raw = '';
  try { raw = fs.readFileSync(CONFIG_PATH, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('[')) continue;
    const m = s.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    } else {
      v = v.replace(/\s+#.*$/, '');   // strip trailing comment on bare values
      v = coerce(v);
    }
    out[m[1]] = v;
  }
  return out;
}

function fmt(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

// Update-or-append the given keys, preserving everything else verbatim.
function writeConfig(updates) {
  let lines = [];
  try { lines = fs.readFileSync(CONFIG_PATH, 'utf8').split('\n'); } catch { lines = []; }
  const rem = { ...updates };
  const patched = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(rem, m[1])) {
      const k = m[1]; const v = rem[k]; delete rem[k];
      return `${k} = ${fmt(v)}`;
    }
    return line;
  });
  const appends = Object.entries(rem).map(([k, v]) => `${k} = ${fmt(v)}`);
  let body = patched.join('\n');
  if (appends.length) body = body.replace(/\n*$/, '\n') + appends.join('\n') + '\n';
  fs.writeFileSync(CONFIG_PATH, body);
  return readConfig();
}

module.exports = { readConfig, writeConfig, CONFIG_PATH };
