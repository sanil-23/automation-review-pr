'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FsmBadge } from './FsmBadge';

type Worker = {
  pr_id: number; title?: string; fsm_state?: string; fix_phase?: string;
  worker_slot?: number; ci_state?: string; coderabbit_approved?: number;
  takeover_started_at?: string; last_error?: string; tmux_window?: string | null;
};
type Resp = { concurrency: number; workers: Worker[] };

const PHASES = ['fix', 'coverage', 'await_ci', 'merge'];

function elapsed(since?: string) {
  if (!since) return '';
  const ms = Date.now() - new Date(since).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`;
}

function Slot({ n, w, onCancel }: { n: number; w?: Worker; onCancel: (pr: number) => void }) {
  return (
    <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 min-w-[150px]">
      <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
        <span>slot {n}</span>
        <span className="flex items-center gap-1">
          {w && <span>{elapsed(w.takeover_started_at)}</span>}
          {w && (
            <button
              title="Cancel takeover + remove from queue"
              onClick={() => { if (confirm(`Cancel takeover of PR #${w.pr_id}?`)) onCancel(w.pr_id); }}
              className="rounded border border-[var(--color-border)] px-1 leading-4 hover:border-[var(--color-red)] hover:text-[var(--color-red)]"
            >×</button>
          )}
        </span>
      </div>
      {!w ? (
        <div className="py-3 text-center text-xs text-[var(--color-text-muted)]">idle</div>
      ) : (
        <div className="text-xs">
          <Link href={`/pr/${w.pr_id}`} className="font-medium text-[var(--color-accent)] hover:underline">#{w.pr_id}</Link>
          <div className="mt-0.5 truncate text-[var(--color-text-muted)]">{w.title || ''}</div>
          <div className="mt-1"><FsmBadge state={w.fsm_state} /></div>
          <div className="mt-1.5 flex gap-1">
            {PHASES.map((p) => (
              <span key={p}
                className={
                  'rounded px-1 py-0.5 text-[10px] ' +
                  (w.fix_phase === p
                    ? 'bg-blue-500/30 text-[var(--color-accent)]'
                    : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]')
                }>
                {p}
              </span>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            CI {w.ci_state || '—'}{w.coderabbit_approved ? ' · CR ✓' : ''}
          </div>
          {w.tmux_window && <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">tmux: {w.tmux_window}</div>}
          {w.last_error && <div className="mt-1 text-[11px] text-[var(--color-red)]">{w.last_error}</div>}
        </div>
      )}
    </div>
  );
}

export function TakeoverPanel() {
  const [data, setData] = useState<Resp | null>(null);
  const load = () => fetch('/api/takeover').then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  const onCancel = async (pr: number) => {
    await fetch('/api/queue/eject', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pr, reason: 'takeover cancelled from dashboard' }),
    });
    load();
  };
  if (!data) return null;
  const bySlot = new Map(data.workers.map((w) => [w.worker_slot, w]));
  const slots = Array.from({ length: data.concurrency }, (_, i) => i + 1);

  return (
    <div className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Takeover workers</h3>
        <span className="text-xs text-[var(--color-text-muted)]">{data.workers.length}/{data.concurrency} busy</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {slots.map((n) => <Slot key={n} n={n} w={bySlot.get(n)} onCancel={onCancel} />)}
      </div>
    </div>
  );
}
