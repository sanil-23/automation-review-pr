'use client';
import { useEffect, useState } from 'react';
import { fsmTone } from './FsmBadge';

type Counts = Record<string, number>;

const REVIEW_STATES = ['NEW', 'IN_REVIEW', 'CHANGES_REQUESTED', 'CLEAN'];
const FIX_STATES = ['QUEUED_FOR_FIX', 'FIXING', 'AWAIT_CI', 'READY_MERGE'];
const DONE_STATES = ['MERGED', 'WINNER', 'CLOSED_LOSER', 'CLOSED_REDUNDANT', 'DISMISSED'];

const toneVar: Record<string, string> = {
  gray: 'var(--color-text-muted)', green: 'var(--color-green)', red: 'var(--color-red)',
  yellow: 'var(--color-yellow)', purple: 'var(--color-purple)', blue: 'var(--color-accent)',
};

function Group({ label, states, counts }: { label: string; states: string[]; counts: Counts }) {
  const total = states.reduce((n, s) => n + (counts[s] || 0), 0);
  return (
    <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
        <span className="text-xl font-semibold">{total}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {states.filter((s) => counts[s]).map((s) => (
          <span key={s} style={{ color: toneVar[fsmTone(s)] }}>{counts[s]} {s.toLowerCase().replace(/_/g, ' ')}</span>
        ))}
        {total === 0 && <span className="text-[var(--color-text-muted)]">—</span>}
      </div>
    </div>
  );
}

export function QueueStats() {
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    const load = () => fetch('/api/queues').then((r) => r.json()).then((d) => setCounts(d.counts || {})).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!counts) return null;
  return (
    <div className="mb-4 flex gap-3">
      <Group label="REVIEW QUEUE" states={REVIEW_STATES} counts={counts} />
      <Group label="FIX QUEUE" states={FIX_STATES} counts={counts} />
      <Group label="DONE / CLOSED" states={DONE_STATES} counts={counts} />
    </div>
  );
}
