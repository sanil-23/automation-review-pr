## STEP 1: PR metadata + diff

```bash
gh pr view __PR_NUMBER__ --repo tinyhumansai/openhuman
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman --stat
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman
```

Extract: title, summary, test plan, linked issues, labels, author, files changed, commit count.

Note red flags: no linked issue on a feature, no test plan, title doesn't match changes, >500 line diff without justification, unrelated changes bundled.

Read the entire diff carefully.

---

## STEP 2: Classify changes

Categorize files into areas and build a targeted checklist:

| Area | Patterns | Key checks |
|------|----------|------------|
| **Rust core** | `src/openhuman/**` | Module layout, controller registry, RpcOutcome, debug logging, no `.unwrap()` |
| **Frontend** | `app/src/**/*.{ts,tsx}` | No dynamic imports, config via `config.ts`, Redux state, `isTauri()` guard |
| **Tauri shell** | `app/src-tauri/**` | Thin host, no JS injection in CEF webviews |
| **Tests** | `*.test.*`, `tests/**` | Co-located, behavior over implementation, no real network |
| **Config** | `.env*`, `config.ts`, `types.rs` | VITE_* via config.ts, TOML Config struct |

---

## STEP 3: Review the code

For each file in the diff:
1. Check against the area-specific checklist above
2. Check known issues from CLAUDE.md (unwrap, PII in logs, dynamic imports, missing logging, etc.)
3. Look for logic bugs, missing error handling, security issues, breaking changes
4. Note deviations from patterns in sibling code (if you need context on patterns, read 1 sibling file)

### Severity levels
- `**[critical]**` — Security, data loss, crashes, broken core functionality
- `**[major]**` — Logic bugs, missing error handling, broken patterns, missing tests
- `**[minor]**` — Style, naming, minor optimization, docs

---
