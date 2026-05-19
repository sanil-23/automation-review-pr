'use client';
import { useEffect, useState } from 'react';
import { usePrStore } from '@/store/usePrStore';
import { StatsBar } from '@/components/StatsBar';
import { FilterBar } from '@/components/FilterBar';
import { PrTable } from '@/components/PrTable';
import { Button } from '@/components/Button';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const { prs, stats, loading, error, load, filters, setFilter } = usePrStore();
  const [busy, setBusy] = useState<null | 'sync' | 'discover'>(null);
  const conflictCount = prs.filter((p) => p.mergeable === 'CONFLICTING').length;
  const conflictFilterActive = filters.mergeable === 'CONFLICTING';

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

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
      <StatsBar stats={stats} />
      <FilterBar />
      {error && <div className="rounded border border-red-500/30 bg-red-500/10 p-3 mb-3 text-sm text-[var(--color-red)]">{error}</div>}
      <PrTable prs={prs} />
    </>
  );
}
