#!/usr/bin/env bash
# Flat-TOML config loader. Sourcing this exports config.toml keys as UPPERCASE
# env vars (review_repo -> REVIEW_REPO), so the rest of the scripts read the
# same variable names as before. Falls back to legacy .env if config.toml is
# absent. No nested tables — `[section]` headers are ignored.
_CONFIG_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${CONFIG_TOML:=$_CONFIG_SH_DIR/../config.toml}"

load_config() {
  local f="${1:-$CONFIG_TOML}"
  if [ -f "$f" ]; then
    local line key val up
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in ''|\#*|\[*) continue ;; esac
      [ "${line#*=}" = "$line" ] && continue            # no '=' → skip
      key="${line%%=*}"; val="${line#*=}"
      key="$(printf '%s' "$key" | tr -d '[:space:]')"
      [ -z "$key" ] && continue
      val="${val%%#*}"                                  # strip trailing comment
      val="$(printf '%s' "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      val="${val%\"}"; val="${val#\"}"                  # strip double quotes
      val="${val%\'}"; val="${val#\'}"                  # strip single quotes
      up="$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')"
      export "$up=$val"
    done < "$f"
  elif [ -f "$_CONFIG_SH_DIR/../.env" ]; then
    set -a; . "$_CONFIG_SH_DIR/../.env"; set +a          # legacy fallback
  fi
}

load_config
