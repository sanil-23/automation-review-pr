'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from './Badge';
import { FsmBadge } from './FsmBadge';

type StateRow = {
  pr_id: number; title?: string; author?: string; url?: string; fsm_state?: string;
  ci_state?: string; coderabbit_approved?: number; review_decision?: string;
  last_review_at?: string; stall_age_hours?: number;
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
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pr }),
  });
}
async function reviewPr(pr: number) {
  await fetch(`/api/queue/review/${pr}`, { method: 'POST' });
}

function ago(iso?: string) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(m) || m < 0) return null;
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}
function ciTone(ci?: string) {
  if (ci === 'SUCCESS') return 'text-[var(--color-green)]';
  if (ci === 'FAILURE') return 'text-[var(--color-red)]';
  if (ci === 'PENDING') return 'text-[var(--color-yellow)]';
  return 'text-[var(--color-text-muted)]';
}

function Row({ r, onEject, onReview }: { r: StateRow; onEject: (pr: number) => void; onReview: (pr: number) => void }) {
  const stalled = (r.stall_age_hours ?? 0) >= STALL_HOURS;
  const inReview = r.fsm_state === 'IN_REVIEW' || r.fsm_state === 'CHANGES_REQUESTED' || r.fsm_state === 'CLEAN' || r.fsm_state === 'NEW';
  const lastReviewed = ago(r.last_review_at);
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/pr/${r.pr_id}`} className="font-medium text-[var(--color-accent)] hover:underline">#{r.pr_id}</Link>
            <span className="truncate text-[var(--color-text-muted)]">{r.title || ''}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            {r.author && <span className="text-[var(--color-text-muted)]">@{r.author}</span>}
            {r.linked_issue ? <span className="text-[var(--color-text-muted)]">issue #{r.linked_issue}</span> : null}
            {r.ci_state && <span className={ciTone(r.ci_state)}>CI {r.ci_state}</span>}
            <span className={r.coderabbit_approved ? 'text-[var(--color-green)]' : 'text-[var(--color-text-muted)]'}>CR {r.coderabbit_approved ? '✓' : '—'}</span>
            {r.review_decision && r.review_decision !== 'NONE' && <span className="text-[var(--color-text-muted)]">{r.review_decision.toLowerCase().replace(/_/g, ' ')}</span>}
            {r.fix_phase && <span className="text-[var(--color-accent)]">{r.fix_phase}</span>}
            <span className="text-[var(--color-text-muted)]">{lastReviewed ? `reviewed ${lastReviewed}` : 'not reviewed'}</span>
            {inReview && <span className={stalled ? 'text-[var(--color-red)]' : 'text-[var(--color-text-muted)]'}>· silent {r.stall_age_hours ?? 0}h/{STALL_HOURS}h</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <FsmBadge state={r.fsm_state} />
          <div className="flex items-center gap-1">
            {inReview && (
              <button title="Review this PR now"
                onClick={() => onReview(r.pr_id)}
                className="rounded border border-[var(--color-border)] px-1.5 py-0.5 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">review</button>
            )}
            {r.url && (
              <a href={r.url} target="_blank" rel="noreferrer" title="Open on GitHub"
                className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">↗</a>
            )}
            <button title="Remove from queue (DISMISS)"
              onClick={() => { if (confirm(`Remove PR #${r.pr_id} from the queue?`)) onEject(r.pr_id); }}
              className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-muted)] hover:border-[var(--color-red)] hover:text-[var(--color-red)]">×</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Lane({ title, tone, rows, onEject, onReview }: { title: string; tone: string; rows: StateRow[]; onEject: (pr: number) => void; onReview: (pr: number) => void }) {
  return (
    <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: tone }}>{title}</h3>
        <Badge tone="gray">{rows.length}</Badge>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.length === 0 && <div className="py-3 text-center text-xs text-[var(--color-text-muted)]">empty</div>}
        {rows.map((r) => <Row key={r.pr_id} r={r} onEject={onEject} onReview={onReview} />)}
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
  const onReview = async (pr: number) => { await reviewPr(pr); setTimeout(load, 1000); };
  if (!data) return null;

  return (
    <div className="mb-5">
      <div className="flex gap-3 items-start">
        <Lane title="REVIEW QUEUE" tone="var(--color-accent)" rows={data.review} onEject={onEject} onReview={onReview} />
        <Lane title="FIX QUEUE" tone="var(--color-yellow)" rows={data.fix} onEject={onEject} onReview={onReview} />
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
