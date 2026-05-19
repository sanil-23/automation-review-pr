## Smart Re-review: Evaluate + Resolve Prior Threads

Fetch all prior review feedback:
```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviewDecision
      commits(last: 20) { nodes { commit { oid committedDate messageHeadline } } }
      reviewThreads(first: 100) {
        nodes {
          id isResolved path line isOutdated
          comments(first: 20) {
            nodes { id databaseId author { login } body createdAt url path line originalLine commit { oid } originalCommit { oid } }
          }
        }
      }
    }
  }
}' -F owner=tinyhumansai -F repo=openhuman -F number=__PR_NUMBER__
```

For each unresolved thread, decide: **resolved by code**, **resolved by explanation**, **still open**, or **superseded**.

If resolved, reply and resolve (only for `graycyrus` threads):
```bash
gh api repos/tinyhumansai/openhuman/pulls/comments/<comment_database_id>/replies -X POST -f body="Confirmed fixed — <reason>."
gh api graphql -f query='mutation($threadId:ID!) { resolveReviewThread(input:{threadId:$threadId}) { thread { id isResolved } } }' -F threadId=<thread_id>
```

Do NOT resolve CodeRabbit/bot threads or other human reviewers' threads. If a prior `REQUEST_CHANGES` from `graycyrus` exists and all changes are addressed, post the new review as `COMMENT` noting previous changes are addressed.

Record all resolution actions in tracking file.

---
