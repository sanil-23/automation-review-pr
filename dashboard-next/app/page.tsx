'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePrStore } from '@/store/usePrStore';
import { useWhoamiStore } from '@/store/useWhoamiStore';
import { StatsBar } from '@/components/StatsBar';
import { FilterBar } from '@/components/FilterBar';
import { PrTable } from '@/components/PrTable';
import { Button } from '@/components/Button';
import { api } from '@/lib/api';

const POLL_FAST = 3000;
const POLL_SLOW = 30000;

export default function DashboardPage() {
  const { prs, stats, loading, error, load, filters, setFilter } = usePrStore();
  const me = useWhoamiStore((s) => s.login);
  const loadMe = useWhoamiStore((s) => s.load);
  const [busy, setBusy] = useState<null | 'sync' | 'discover'>(null);
  const conflictCount = prs.filter((p) => p.mergeable === 'CONFLICTING').length;
  const conflictFilterActive = filters.mergeable === 'CONFLICTING';
  const meLower = me?.toLowerCase() ?? null;
  const mineCount = meLower
    ? prs.filter((p) => (p.assignees || '').toLowerCase().includes(meLower)).length
    : 0;
  const mineFilterActive = me ? filters.assignee === me : false;

  const runningPrs = prs.filter((p) => p.is_running);
  // Also account for status.json signalling a PR that the DB query didn't flag
  const liveStatus = stats?.liveStatus;
  if (liveStatus?.running && liveStatus.pr && !runningPrs.some((p) => p.id === liveStatus.pr)) {
    const fromList = prs.find((p) => p.id === liveStatus.pr);
    if (fromList) runningPrs.push(fromList);
  }
  const anyRunning = runningPrs.length > 0;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rateRef = useRef(POLL_SLOW);

  useEffect(() => {
    loadMe();
    load();
    intervalRef.current = setInterval(load, POLL_SLOW);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load, loadMe]);

  // Switch polling rate when a review is active
  useEffect(() => {
    const desired = anyRunning ? POLL_FAST : POLL_SLOW;
    if (desired !== rateRef.current) {
      rateRef.current = desired;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(load, desired);
    }
  }, [anyRunning, load]);

  const handleSync = async () => {
    setBusy('sync');
    try { await api.syncAll(); await load(); } finally { setBusy(null); }
  };
  const handleDiscover = async () => {
    setBusy('discover');
    try { await api.triggerDiscover(); } catch (e: any) { alert(e.message); } finally { setBusy(null); }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-sm text-[var(--color-text-muted)]">
            {loading && prs.length === 0 ? 'Loading…' : `${prs.length} PR${prs.length === 1 ? '' : 's'}`}
          </h2>
          {(conflictCount > 0 || conflictFilterActive) && (
            <button
              onClick={() => setFilter('mergeable', conflictFilterActive ? undefined : 'CONFLICTING')}
              className={
                'rounded border px-2 py-1 text-xs font-medium transition-colors ' +
                (conflictFilterActive
                  ? 'border-[var(--color-red)] bg-red-500/20 text-[var(--color-red)]'
                  : 'border-red-500/30 bg-red-500/10 text-[var(--color-red)] hover:bg-red-500/20')
              }
              title={conflictFilterActive ? 'Clear conflict filter' : 'Show only conflicting PRs'}
            >
              {conflictFilterActive ? `Conflicts only (${conflictCount}) ×` : `${conflictCount} with conflicts`}
            </button>
          )}
          {me && (mineCount > 0 || mineFilterActive) && (
            <button
              onClick={() => setFilter('assignee', mineFilterActive ? undefined : me)}
              className={
                'rounded border px-2 py-1 text-xs font-medium transition-colors ' +
                (mineFilterActive
                  ? 'border-[var(--color-accent)] bg-blue-500/20 text-[var(--color-accent)]'
                  : 'border-blue-500/30 bg-blue-500/10 text-[var(--color-accent)] hover:bg-blue-500/20')
              }
              title={mineFilterActive ? 'Clear mine filter' : 'Show only PRs assigned to me'}
            >
              {mineFilterActive ? `Mine only (${mineCount}) ×` : `${mineCount} assigned to me`}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSync} disabled={busy !== null} size="sm">
            {busy === 'sync' ? 'Syncing…' : 'Sync'}
          </Button>
          <Button onClick={handleDiscover} disabled={busy !== null} size="sm" variant="primary">
            {busy === 'discover' ? 'Running…' : 'Discover & Review'}
          </Button>
        </div>
      </div>
      {runningPrs.length > 0 && (
        <div className="flex items-center gap-2 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 mb-4 text-sm">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
          </span>
          <span>
            Reviewing{' '}
            {runningPrs.map((pr, i) => (
              <span key={pr.id}>
                {i > 0 && ', '}
                <Link href={`/pr/${pr.id}`} className="text-[var(--color-accent)] font-medium hover:underline">
                  PR #{pr.id}
                </Link>
              </span>
            ))}
            …
          </span>
        </div>
      )}
      <StatsBar stats={stats} />
      <FilterBar />
      {error && <div className="rounded border border-red-500/30 bg-red-500/10 p-3 mb-3 text-sm text-[var(--color-red)]">{error}</div>}
      <PrTable prs={prs} />
    </>
  );
}
