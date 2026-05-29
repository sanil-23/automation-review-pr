'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from './Badge';
import { FsmBadge } from './FsmBadge';

type StateRow = {
  pr_id: number; title?: string; author?: string; fsm_state?: string;
  ci_state?: string; coderabbit_approved?: number; stall_age_hours?: number;
  linked_issue?: number; winner_pr?: number; dedup_verdict?: string;
  fix_phase?: string; worker_slot?: number; last_error?: string;
};
type QueuesResp = {
  review: StateRow[]; fix: StateRow[];
  issueGroups: { issue: number; prs: StateRow[] }[];
  counts: Record<string, number>;
};

const STALL_HOURS = 24;

async function ejectPr(pr: number) {
  await fetch('/api/queue/eject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pr }),
  });
}

function Row({ r, onEject }: { r: StateRow; onEject: (pr: number) => void }) {
  const stalled = (r.stall_age_hours ?? 0) >= STALL_HOURS;
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 text-xs">
      <div className="min-w-0">
        <Link href={`/pr/${r.pr_id}`} className="font-medium text-[var(--color-accent)] hover:underline">#{r.pr_id}</Link>
        <span className="ml-2 truncate text-[var(--color-text-muted)]">{r.title || ''}</span>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
          {r.author && <span>@{r.author}</span>}
          {r.linked_issue && <span>· issue #{r.linked_issue}</span>}
          {r.ci_state && <span>· CI {r.ci_state}</span>}
          {r.coderabbit_approved ? <span>· CR ✓</span> : null}
          {r.fix_phase && <span>· {r.fix_phase}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex flex-col items-end gap-0.5">
          <FsmBadge state={r.fsm_state} />
          {r.fsm_state && (r.fsm_state === 'IN_REVIEW' || r.fsm_state === 'CHANGES_REQUESTED') && (
            <span className={stalled ? 'text-[var(--color-red)]' : 'text-[var(--color-text-muted)]'}>
              silent {r.stall_age_hours ?? 0}h / {STALL_HOURS}h
            </span>
          )}
        </div>
        <button
          title="Remove from queue (DISMISS)"
          onClick={() => { if (confirm(`Remove PR #${r.pr_id} from the queue?`)) onEject(r.pr_id); }}
          className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-muted)] hover:border-[var(--color-red)] hover:text-[var(--color-red)]"
        >×</button>
      </div>
    </div>
  );
}

function Lane({ title, tone, rows, onEject }: { title: string; tone: string; rows: StateRow[]; onEject: (pr: number) => void }) {
  return (
    <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: tone }}>{title}</h3>
        <Badge tone="gray">{rows.length}</Badge>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.length === 0 && <div className="py-3 text-center text-xs text-[var(--color-text-muted)]">empty</div>}
        {rows.map((r) => <Row key={r.pr_id} r={r} onEject={onEject} />)}
      </div>
    </div>
  );
}

export function QueueBoard() {
  const [data, setData] = useState<QueuesResp | null>(null);
  const load = () => fetch('/api/queues').then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const onEject = async (pr: number) => { await ejectPr(pr); load(); };
  if (!data) return null;

  return (
    <div className="mb-5">
      <div className="flex gap-3">
        <Lane title="REVIEW QUEUE" tone="var(--color-accent)" rows={data.review} onEject={onEject} />
        <Lane title="FIX QUEUE" tone="var(--color-yellow)" rows={data.fix} onEject={onEject} />
      </div>

      {data.issueGroups.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
          <h3 className="mb-2 text-sm font-semibold">Duplicate-issue groups</h3>
          <div className="flex flex-col gap-2">
            {data.issueGroups.map((g) => (
              <div key={g.issue} className="text-xs">
                <span className="text-[var(--color-text-muted)]">issue #{g.issue}:</span>{' '}
                {g.prs.map((p) => (
                  <span key={p.pr_id} className="ml-1">
                    <Link href={`/pr/${p.pr_id}`} className="hover:underline">#{p.pr_id}</Link>
                    <span className="ml-1"><FsmBadge state={p.fsm_state} /></span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
