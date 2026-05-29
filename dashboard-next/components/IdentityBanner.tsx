'use client';
import { useEffect, useState } from 'react';

type Identity = {
  ok: boolean; gh_authenticated?: boolean; gh_login?: string;
  git_user_name?: string; git_user_email?: string; me?: string; problems?: string[];
};

export function IdentityBanner() {
  const [id, setId] = useState<Identity | null>(null);
  useEffect(() => {
    fetch('/api/identity-check').then((r) => r.json()).then(setId).catch(() => {});
  }, []);
  if (!id || id.ok) return null; // only show on mismatch

  return (
    <div className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
      <div className="font-medium text-[var(--color-red)]">⚠ gh / git identity mismatch</div>
      <ul className="mt-1 list-disc pl-5 text-xs text-[var(--color-text-muted)]">
        {(id.problems || []).map((p, i) => <li key={i}>{p}</li>)}
      </ul>
      <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        gh: <b>{id.gh_login || '—'}</b> · git: <b>{id.git_user_name || '—'}</b> &lt;{id.git_user_email || '—'}&gt; · ME: <b>{id.me || '—'}</b>.
        Fix with <code>gh auth login</code> / <code>git config user.name</code> so reviews and merges are attributed correctly.
      </div>
    </div>
  );
}
