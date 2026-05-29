'use client';
import { useEffect, useState } from 'react';

type Setup = {
  configured: boolean; review_repo: string; me: string;
  autonomy: string; stall_hours: number; takeover_concurrency: number;
  repo_ok?: boolean; repo_warning?: string;
};

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function SetupWizard() {
  const [s, setS] = useState<Setup | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ review_repo: '', me: '', autonomy: 'full', stall_hours: 24, takeover_concurrency: 5 });
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState('');

  const load = () =>
    fetch('/api/setup').then((r) => r.json()).then((d: Setup) => {
      setS(d);
      setForm({
        review_repo: d.review_repo, me: d.me, autonomy: d.autonomy || 'full',
        stall_hours: d.stall_hours || 24, takeover_concurrency: d.takeover_concurrency || 5,
      });
      if (!d.configured) setOpen(true); // force first-run setup
    }).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!s) return null;

  const repoValid = REPO_RE.test(form.review_repo.trim());
  const firstRun = !s.configured;

  const save = async () => {
    if (!repoValid) return;
    setBusy(true); setWarn('');
    try {
      const r = await fetch('/api/setup', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
      });
      const d: Setup = await r.json();
      setS(d);
      if (d.repo_warning) setWarn(d.repo_warning);
      else setOpen(false);
    } finally { setBusy(false); }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Repo & reviewer settings"
        className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >⚙ {s.review_repo || 'set repo'}</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl">
            <h2 className="text-base font-semibold">{firstRun ? 'Welcome — set up the reviewer' : 'Repo & reviewer settings'}</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Set the <b>main repo</b> the reviewer operates on and the <code>pnpm review fix</code> takeovers run against.
            </p>

            <label className="mt-4 block text-xs font-medium">Main repo (owner/name) *</label>
            <input
              autoFocus value={form.review_repo}
              onChange={(e) => setForm({ ...form, review_repo: e.target.value })}
              placeholder="sanil-23/automation-review-pr" spellCheck={false}
              className={'mt-1 w-full rounded border bg-[var(--color-bg-secondary)] px-2 py-1.5 font-mono text-sm ' +
                (form.review_repo && !repoValid ? 'border-[var(--color-red)]' : 'border-[var(--color-border)]')}
            />
            {form.review_repo && !repoValid && <div className="mt-1 text-[11px] text-[var(--color-red)]">must be owner/name</div>}

            <label className="mt-3 block text-xs font-medium">Your GitHub login (reviews/PRs attributed here)</label>
            <input value={form.me} onChange={(e) => setForm({ ...form, me: e.target.value })}
              placeholder="sanil-23" spellCheck={false}
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 font-mono text-sm" />

            <div className="mt-3 flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium">Autonomy</label>
                <select value={form.autonomy} onChange={(e) => setForm({ ...form, autonomy: e.target.value })}
                  className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 text-sm">
                  <option value="full">full (auto close + merge)</option>
                  <option value="manual">manual (stop before close/merge)</option>
                </select>
              </div>
              <div className="w-24">
                <label className="block text-xs font-medium">Stall (h)</label>
                <input type="number" min={1} value={form.stall_hours}
                  onChange={(e) => setForm({ ...form, stall_hours: +e.target.value })}
                  className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 text-sm" />
              </div>
              <div className="w-24">
                <label className="block text-xs font-medium">Workers</label>
                <input type="number" min={1} value={form.takeover_concurrency}
                  onChange={(e) => setForm({ ...form, takeover_concurrency: +e.target.value })}
                  className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 text-sm" />
              </div>
            </div>

            {warn && <div className="mt-3 rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1.5 text-[11px] text-[var(--color-yellow)]">{warn}</div>}

            <div className="mt-4 flex justify-end gap-2">
              {!firstRun && (
                <button onClick={() => setOpen(false)} disabled={busy}
                  className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)]">Cancel</button>
              )}
              <button onClick={save} disabled={busy || !repoValid}
                className="rounded border border-[var(--color-accent)] bg-blue-500/15 px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:opacity-50">
                {busy ? 'Saving…' : firstRun ? 'Save & start' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
