'use client';
import { useState } from 'react';
import { Button } from './Button';
import { api } from '@/lib/api';
import type { Pr } from '@/lib/types';

export function PrActions({ pr, onAction }: { pr: Pr; onAction: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); onAction(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => run('sync', () => api.syncPr(pr.id))} disabled={busy !== null}>
        {busy === 'sync' ? 'Syncing…' : 'Sync'}
      </Button>

      {pr.is_running ? (
        <Button size="sm" variant="red" onClick={() => run('cancel', () => api.cancelJob(`review-${pr.id}`))} disabled={busy !== null}>
          {busy === 'cancel' ? 'Cancelling…' : 'Cancel Review'}
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={() => run('review', () => api.triggerReview(pr.id))} disabled={busy !== null}>
          {busy === 'review' ? 'Starting…' : (pr.cycles?.length ?? 0) > 0 ? 'Trigger Re-review' : 'Trigger Review'}
        </Button>
      )}

      {pr.status === 'clean' && !pr.is_running && (
        <Button size="sm" variant="green" onClick={() => run('approve', () => api.approve(pr.id))} disabled={busy !== null}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
      )}

      {pr.status === 'approved' && (
        <Button size="sm" variant="red" onClick={() => run('unapprove', () => api.unapprove(pr.id))} disabled={busy !== null}>
          {busy === 'unapprove' ? 'Unapproving…' : 'Unapprove'}
        </Button>
      )}

      {(pr.status === 'approved' || pr.review_decision === 'APPROVED') && !pr.is_running && (
        <Button size="sm" variant="purple" onClick={() => {
          if (!confirm(`Merge PR #${pr.id}?`)) return;
          run('merge', () => api.merge(pr.id));
        }} disabled={busy !== null}>
          {busy === 'merge' ? 'Merging…' : 'Merge'}
        </Button>
      )}
    </div>
  );
}
