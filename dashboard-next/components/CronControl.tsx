'use client';
import { useEffect, useRef, useState } from 'react';

type Cfg = { enabled: boolean; scout: string; review: string; stall: string };
type JobState = { running: boolean; pid: number | null; lastRun: string | null; lastExit: number | null };
type SchedState = { config: Cfg; jobs: Record<string, JobState>; active: boolean };

const ROWS: { key: keyof Cfg; job: string; label: string; hint: string }[] = [
  { key: 'scout', job: 'scout', label: 'Cron 1 · scout-assign', hint: 'discover + assign + dedup' },
  { key: 'review', job: 'review', label: 'Cron 2 · review-cron', hint: 'review changed PRs' },
  { key: 'stall', job: 'stall', label: 'Cron 3 · stall-watch', hint: 'stall → takeover' },
];

const validCron = (e: string) => e.trim().split(/\s+/).length === 5;
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
};

export function CronControl() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [sched, setSched] = useState<SchedState | null>(null);
  const [crontab, setCrontab] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  // While the user is editing the schedule, the 5s poll must NOT overwrite the
  // form with the server value (that would wipe in-progress edits).
  const dirtyRef = useRef(false);

  const load = () =>
    fetch('/api/cron-config').then((r) => r.json()).then((d) => {
      if (!dirtyRef.current) setCfg(d.config);   // only refresh the form when not editing
      setSched(d.scheduler); setCrontab(d.crontabInstalled);
    }).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  if (!cfg) return null;
  const invalid = [cfg.scout, cfg.review, cfg.stall].some((e) => !validCron(e));

  const apply = async (override?: Partial<Cfg>) => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/cron-config', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...cfg, ...override }),
      });
      const d = await r.json();
      dirtyRef.current = false;            // saved — let polling refresh again
      setCfg(d.config); setSched(d.scheduler);
      setMsg('Saved — scheduler picks it up on the next tick.');
    } finally { setBusy(false); }
  };
  const runNow = async (job: string) => {
    await fetch('/api/cron-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job }) });
    setTimeout(load, 500);
  };

  return (
    <div className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-semibold">
          <span>{open ? '▾' : '▸'}</span> Cron schedule
          <span className={'rounded border px-2 py-0.5 text-[11px] ' + (cfg.enabled && sched?.active
            ? 'border-green-500/30 text-[var(--color-green)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]')}>
            {cfg.enabled ? (sched?.active ? 'in-process scheduler running' : 'enabled') : 'disabled'}
          </span>
          {crontab && <span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">+ OS crontab</span>}
        </button>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={cfg.enabled} disabled={busy} onChange={(e) => apply({ enabled: e.target.checked })} />
          enabled
        </label>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {ROWS.map((row) => {
            const js = sched?.jobs?.[row.job];
            return (
              <div key={row.key} className="flex items-center gap-2 text-xs">
                <div className="w-44 shrink-0">
                  <div className="font-medium">{row.label}</div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">{row.hint}</div>
                </div>
                <input
                  value={cfg[row.key] as string}
                  onChange={(e) => { dirtyRef.current = true; setCfg({ ...cfg, [row.key]: e.target.value }); }}
                  spellCheck={false}
                  className={'flex-1 rounded border bg-[var(--color-bg-secondary)] px-2 py-1 font-mono ' +
                    (validCron(cfg[row.key] as string) ? 'border-[var(--color-border)]' : 'border-[var(--color-red)]')}
                  placeholder="*/20 * * * *"
                />
                <span className="w-28 shrink-0 text-right text-[11px] text-[var(--color-text-muted)]">
                  {js?.running ? <span className="text-[var(--color-accent)]">running…</span> : `ran ${ago(js?.lastRun ?? null)}`}
                </span>
                <button onClick={() => runNow(row.job)} disabled={js?.running}
                  className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-40">
                  Run now
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-3">
            <button onClick={() => apply()} disabled={busy || invalid}
              className="rounded border border-[var(--color-accent)] bg-blue-500/10 px-3 py-1 text-xs text-[var(--color-accent)] disabled:opacity-50">
              {busy ? 'Saving…' : 'Apply schedule'}
            </button>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              5-field cron syntax. Runs in-process while the dashboard is up — no OS crontab required.
            </span>
            {msg && <span className="text-[11px] text-[var(--color-text-muted)]">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
