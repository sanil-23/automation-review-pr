'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type Active = { reviewing: number[]; takeover: number[]; crons: string[] };

function Pulse() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-500" />
    </span>
  );
}

function Prs({ ids }: { ids: number[] }) {
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <Link href={`/pr/${id}`} className="font-medium text-[var(--color-accent)] hover:underline">#{id}</Link>
        </span>
      ))}
    </>
  );
}

export function ActivityBar() {
  const [a, setA] = useState<Active | null>(null);
  useEffect(() => {
    const load = () => fetch('/api/active').then((r) => r.json()).then(setA).catch(() => {});
    load();
    const t = setInterval(load, 2000);   // fast poll — this is the live view
    return () => clearInterval(t);
  }, []);
  if (!a) return null;

  const idle = a.reviewing.length === 0 && a.takeover.length === 0 && a.crons.length === 0;
  if (idle) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
        <span className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]" /> Idle — nothing running
      </div>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm">
      <span className="flex items-center gap-2"><Pulse /><span className="font-medium">Live</span></span>
      {a.reviewing.length > 0 && <span>Reviewing <Prs ids={a.reviewing} /></span>}
      {a.takeover.length > 0 && <span>Taking over <Prs ids={a.takeover} /></span>}
      {a.crons.length > 0 && <span className="text-[var(--color-text-muted)]">cron: {a.crons.join(', ')} running</span>}
    </div>
  );
}
