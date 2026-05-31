'use client';
import { useState } from 'react';
import { QueueStats } from '@/components/QueueStats';
import { QueueBoard } from '@/components/QueueBoard';
import { TakeoverPanel } from '@/components/TakeoverPanel';
import { ActivityBar } from '@/components/ActivityBar';
import { CronControl } from '@/components/CronControl';
import { Button } from '@/components/Button';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const [busy, setBusy] = useState<null | 'discover' | 'sync'>(null);
  const [msg, setMsg] = useState('');

  const handleDiscover = async () => {
    setBusy('discover'); setMsg('');
    try { await api.triggerDiscover(); setMsg('Discovery started — queue will populate shortly.'); }
    catch (e: any) { setMsg(e.message); }
    finally { setBusy(null); }
  };
  const handleSync = async () => {
    setBusy('sync'); setMsg('');
    try { await api.syncAll(); setMsg('GitHub sync triggered.'); }
    catch (e: any) { setMsg(e.message); }
    finally { setBusy(null); }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm text-[var(--color-text-muted)]">Reviewer queues</h2>
        <div className="flex items-center gap-2">
          {msg && <span className="text-[11px] text-[var(--color-text-muted)]">{msg}</span>}
          <Button onClick={handleSync} disabled={busy !== null} size="sm">
            {busy === 'sync' ? 'Syncing…' : 'Sync GitHub'}
          </Button>
          <Button onClick={handleDiscover} disabled={busy !== null} size="sm" variant="primary">
            {busy === 'discover' ? 'Discovering…' : 'Discover (scout)'}
          </Button>
        </div>
      </div>

      <ActivityBar />
      <QueueStats />
      <CronControl />
      <TakeoverPanel />
      <QueueBoard />
    </>
  );
}
