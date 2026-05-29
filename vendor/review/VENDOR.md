# Vendored: openhuman `pnpm review` toolkit

Source: `tinyhumansai/openhuman` → `scripts/shortcuts/review/`
Source commit: e6b32070f622d1da0709e32be48d5f71fe77bbd5 (2026-05-28)
Vendored: 2026-05-29

Drives the autonomous takeover (Cron 3): `cli.sh fix|coverage|merge <pr>`.
Repo target comes from `REVIEW_REPO=owner/name` (env) — the same variable the
reviewer system uses, so it composes without edits.

Re-sync: re-copy from the source path above and bump the commit hash.
Do NOT hand-edit vendored files except the documented adaptations:
  - (none yet — runs unmodified against a non-submodule repo; `git submodule
    update` in sync.sh is a harmless no-op when there are no submodules.)
