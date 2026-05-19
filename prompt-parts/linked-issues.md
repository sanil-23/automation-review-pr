## Linked Issues Check

The PR references issues. For each linked issue:
```bash
gh issue view <issue-number> --repo tinyhumansai/openhuman
```

Extract acceptance criteria. Then do a three-way verification:
1. **Issue** — what was asked for
2. **PR description** — what the PR claims to do
3. **Actual code** — what was implemented

Flag as BLOCKING if the PR claims to close an issue but doesn't meet acceptance criteria.

---
