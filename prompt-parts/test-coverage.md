## Test Coverage Check

Logic files changed. For each new/modified function or component:
- Is there a corresponding test? Does it cover the happy path + edge cases from acceptance criteria?
- If behavior changed, were tests updated? PRs must meet >= 80% coverage on changed lines.

```bash
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman --stat | grep -E '\.test\.(ts|tsx)|tests/'
```

If no test files in a PR with significant logic changes, flag it.

---
