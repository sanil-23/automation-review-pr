## Dependency Audit

Dependency files changed. For each new dependency:
- **Rust crates**: check if actively maintained, license compatible (MIT/Apache-2.0), dependency tree size
- **JS packages**: check weekly downloads, license, dev vs production dependency

```bash
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman | grep -A2 '^\+.*\[dependencies'
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman | grep '^\+.*"dependencies\|^\+.*"devDependencies'
```

---
