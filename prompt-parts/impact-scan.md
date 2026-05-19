## Impact Scan

Exported functions/types or shared state changed. For each changed signature/export:
```bash
grep -rn "functionName" app/src/ src/ --include='*.ts' --include='*.tsx' --include='*.rs'
```

Check: all callers pass new args, removed exports have no importers, Redux state shape changes have migration + updated selectors, RPC method changes reflected in frontend.

---
