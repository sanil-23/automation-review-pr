## Update Tracking File

Write to `/Users/cyrus/Desktop/automation/review-pr/tinyhumansai-openhuman/PR-__PR_NUMBER__.md`:

```markdown
# PR #__PR_NUMBER__ — <title>
- **Author**: @<login>
- **Branch**: <head> → <base>
- **Created**: <date>
- **URL**: https://github.com/tinyhumansai/openhuman/pull/__PR_NUMBER__
- **Status**: <changes-requested | clean>
- **Last reviewed commit**: <sha>
- **Last review date**: <ISO timestamp>

## Review History

### Review <n> — <ISO timestamp>
**Type**: Fresh | Continuation
**Commit**: <sha>
**Summary**: <2-3 sentences: what files changed, what the PR does, key modifications>
**Gates**: CI pass | Conflicts pass | Unresolved feedback pass
**Areas changed**: <areas>
**Red flags**: <flags or "None">
**Linked issues**: <issues or "None">
**PR-Issue alignment**: <details>
**CodeRabbit dedup**: <what was skipped>
**Resolution actions**: <thread actions or "None">
**Surrounding code patterns checked**: <modules + files read, or "None">
**Dependency audit**: <findings or N/A>
**Test coverage**: <findings or N/A>
**Impact scan**: <findings or N/A>
**Findings**:
- [critical] <file:line> — <description>
- [major] <file:line> — <description>
- [minor] <file:line> — <description>
**Action taken**: <action>
**GitHub review URL**: <link or N/A>
```

For continuation reviews, **append** a new "Review <n>" section — don't overwrite.

### Status logic
- 0 critical/major + all prior `graycyrus` changes resolved → `clean` → **move** to `/Users/cyrus/Desktop/automation/review-pr/to-be-approved/PR-__PR_NUMBER__.md`
- Any critical/major → `changes-requested` → keep in `tinyhumansai-openhuman/`
- BLOCKED (mismatch) → `blocked` → keep in `tinyhumansai-openhuman/`

---
