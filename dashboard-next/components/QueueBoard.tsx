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
  review: StateRow[]; fix: StateRow[]; closed: StateRow[];
  issueGroups: { issue: number; prs: StateRow[] }[];
  counts: Record<string, number>;
};

const STALL_HOURS = 24;
const REVIEW_STATES = ['NEW', 'IN_REVIEW', 'CHANGES_REQUESTED', 'CLEAN'];

type Kind = 'review' | 'approve' | 'close' | 'takeover' | 'merge' | 'requeue' | 'confirm-close' | 'eject';

async function dispatch(pr: number, kind: Kind) {
  if (kind === 'eject') return fetch('/api/queue/eject', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pr }) });
  if (kind === 'review') return fetch(`/api/queue/review/${pr}`, { method: 'POST' });
  if (kind === 'merge') return fetch(`/api/queue/merge/${pr}`, { method: 'POST' });
  return fetch(`/api/queue/action/${pr}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: kind }) });
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

const btn = 'rounded border border-[var(--color-border)] px-1.5 py-0.5';
const btnHover = `${btn} hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]`;
const btnDanger = `${btn} text-[var(--color-text-muted)] hover:border-[var(--color-red)] hover:text-[var(--color-red)]`;

function Actions({ r, act }: { r: StateRow; act: (pr: number, kind: Kind, confirm?: string) => void }) {
  const s = r.fsm_state || '';
  const inReview = REVIEW_STATES.includes(s);
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {inReview && <button title="Review this PR now" onClick={() => act(r.pr_id, 'review')} className={btnHover}>review</button>}
      {inReview && <button title="Approve this PR" onClick={() => act(r.pr_id, 'approve', `Approve PR #${r.pr_id}?`)} className={btnHover}>approve</button>}
      {inReview && <button title="Take over now (skip the stall wait)" onClick={() => act(r.pr_id, 'takeover', `Take over PR #${r.pr_id} now (fix + CI)?`)} className={btnHover}>take over</button>}
      {inReview && <button title="Close this PR on GitHub" onClick={() => act(r.pr_id, 'close', `Close PR #${r.pr_id} on GitHub?`)} className={btnDanger}>close</button>}
      {s === 'READY_MERGE' && <button title="Merge this PR" onClick={() => act(r.pr_id, 'merge', `Merge PR #${r.pr_id}?`)} className={btnHover}>merge</button>}
      {s === 'DISMISSED' && <button title="Re-queue for review" onClick={() => act(r.pr_id, 'requeue')} className={btnHover}>re-queue</button>}
      {s === 'CLOSED_LOSER' && <button title="Confirm close on GitHub" onClick={() => act(r.pr_id, 'confirm-close', `Close loser PR #${r.pr_id} on GitHub?`)} className={btnDanger}>confirm close</button>}
      {s === 'CLOSED_LOSER' && <button title="Re-queue instead" onClick={() => act(r.pr_id, 'requeue')} className={btnHover}>re-queue</button>}
      {r.url && <a href={r.url} target="_blank" rel="noreferrer" title="Open on GitHub" className={`${btn} text-[var(--color-text-muted)] hover:text-[var(--color-accent)]`}>↗</a>}
      <button title="Remove from queue (DISMISS)" onClick={() => act(r.pr_id, 'eject', `Remove PR #${r.pr_id} from the queue?`)} className={btnDanger}>×</button>
    </div>
  );
}

function Row({ r, act, live }: { r: StateRow; act: (pr: number, kind: Kind, confirm?: string) => void; live?: boolean }) {
  const stalled = (r.stall_age_hours ?? 0) >= STALL_HOURS;
  const inReview = REVIEW_STATES.includes(r.fsm_state || '');
  const lastReviewed = ago(r.last_review_at);
  return (
    <div className={'rounded border px-2 py-1.5 text-xs ' + (live ? 'border-yellow-500/40 bg-yellow-500/10' : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {live && (
              <span className="relative flex h-2 w-2" title="reviewing now">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-500" />
              </span>
            )}
            <Link href={`/pr/${r.pr_id}`} className="font-medium text-[var(--color-accent)] hover:underline">#{r.pr_id}</Link>
            <span className="truncate text-[var(--color-text-muted)]">{r.title || ''}</span>
            {live && <span className="text-[11px] text-[var(--color-yellow)]">reviewing…</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            {r.author && <span className="text-[var(--color-text-muted)]">@{r.author}</span>}
            {r.linked_issue ? <span className="text-[var(--color-text-muted)]">issue #{r.linked_issue}</span> : null}
            {r.ci_state && <span className={ciTone(r.ci_state)}>CI {r.ci_state}</span>}
            <span className={r.coderabbit_approved ? 'text-[var(--color-green)]' : 'text-[var(--color-text-muted)]'}>CR {r.coderabbit_approved ? '✓' : '—'}</span>
            {r.review_decision && r.review_decision !== 'NONE' && <span className="text-[var(--color-text-muted)]">{r.review_decision.toLowerCase().replace(/_/g, ' ')}</span>}
            {r.fix_phase && <span className="text-[var(--color-accent)]">{r.fix_phase}</span>}
            {r.dedup_verdict && <span className="text-[var(--color-text-muted)]">{r.dedup_verdict}</span>}
            <span className="text-[var(--color-text-muted)]">{lastReviewed ? `reviewed ${lastReviewed}` : 'not reviewed'}</span>
            {inReview && <span className={stalled ? 'text-[var(--color-red)]' : 'text-[var(--color-text-muted)]'}>· silent {r.stall_age_hours ?? 0}h/{STALL_HOURS}h</span>}
          </div>
          {r.last_error && <div className="mt-0.5 text-[11px] text-[var(--color-red)]">{r.last_error}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <FsmBadge state={r.fsm_state} />
          <Actions r={r} act={act} />
        </div>
      </div>
    </div>
  );
}

function Lane({ title, tone, rows, act, live }: { title: string; tone: string; rows: StateRow[]; act: (pr: number, kind: Kind, confirm?: string) => void; live: Set<number> }) {
  return (
    <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: tone }}>{title}</h3>
        <Badge tone="gray">{rows.length}</Badge>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.length === 0 && <div className="py-3 text-center text-xs text-[var(--color-text-muted)]">empty</div>}
        {rows.map((r) => <Row key={r.pr_id} r={r} act={act} live={live.has(r.pr_id)} />)}
      </div>
    </div>
  );
}

export function QueueBoard() {
  const [data, setData] = useState<QueuesResp | null>(null);
  const [live, setLive] = useState<Set<number>>(new Set());
  const [showClosed, setShowClosed] = useState(false);
  const load = () => fetch('/api/queues').then((r) => r.json()).then(setData).catch(() => {});
  const loadLive = () => fetch('/api/active').then((r) => r.json())
    .then((a) => setLive(new Set([...(a.reviewing || []), ...(a.takeover || [])]))).catch(() => {});
  useEffect(() => {
    load(); loadLive();
    const t = setInterval(load, 5000);
    const tl = setInterval(loadLive, 2000);
    return () => { clearInterval(t); clearInterval(tl); };
  }, []);
  const act = async (pr: number, kind: Kind, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    await dispatch(pr, kind);
    setTimeout(load, 800);
  };
  if (!data) return null;
  const closed = data.closed || [];

  return (
    <div className="mb-5">
      <div className="flex gap-3 items-start">
        <Lane title="REVIEW QUEUE" tone="var(--color-accent)" rows={data.review} act={act} live={live} />
        <Lane title="FIX QUEUE" tone="var(--color-yellow)" rows={data.fix} act={act} live={live} />
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

      {closed.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
          <button onClick={() => setShowClosed((o) => !o)} className="flex items-center gap-2 text-sm font-semibold">
            <span>{showClosed ? '▾' : '▸'}</span> Closed / Dismissed <Badge tone="gray">{closed.length}</Badge>
          </button>
          {showClosed && (
            <div className="mt-2 flex flex-col gap-1.5">
              {closed.map((r) => <Row key={r.pr_id} r={r} act={act} live={live.has(r.pr_id)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
