import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
const pexecFile = promisify(execFile);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const envfile = require('@/lib/envfile');

export const dynamic = 'force-dynamic';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function snapshot() {
  const e = envfile.readEnv();
  return {
    configured: !!(e.REVIEW_REPO && e.REVIEW_REPO.trim()),
    review_repo: e.REVIEW_REPO || '',
    me: e.ME || '',
    autonomy: e.AUTONOMY || 'full',
    stall_hours: Number(e.STALL_HOURS || 24),
    takeover_concurrency: Number(e.TAKEOVER_CONCURRENCY || 5),
  };
}

export async function GET() {
  return NextResponse.json(snapshot());
}

// POST { review_repo, me?, autonomy?, stall_hours?, takeover_concurrency? }
// Sets the main repo the pnpm fixes / reviews run against. Validates the
// owner/name shape and (best-effort) that gh can see the repo.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const repo = String(b.review_repo || '').trim();
  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ error: 'review_repo must be "owner/name"' }, { status: 400 });
  }

  // Best-effort reachability check (non-fatal — gh auth/visibility may differ).
  let repo_ok = false; let repo_warning = '';
  try {
    await pexecFile('gh', ['repo', 'view', repo, '--json', 'nameWithOwner']);
    repo_ok = true;
  } catch (e: any) {
    repo_warning = `gh could not access ${repo} (${(e.stderr || e.message || '').toString().trim().split('\n')[0]}). Saved anyway.`;
  }

  const updates: Record<string, string> = { REVIEW_REPO: repo };
  if (typeof b.me === 'string' && b.me.trim()) updates.ME = b.me.trim();
  if (b.autonomy === 'full' || b.autonomy === 'manual') updates.AUTONOMY = b.autonomy;
  if (Number.isFinite(+b.stall_hours) && +b.stall_hours > 0) updates.STALL_HOURS = String(Math.floor(+b.stall_hours));
  if (Number.isFinite(+b.takeover_concurrency) && +b.takeover_concurrency >= 1)
    updates.TAKEOVER_CONCURRENCY = String(Math.floor(+b.takeover_concurrency));

  envfile.writeEnv(updates);
  return NextResponse.json({ ...snapshot(), repo_ok, repo_warning });
}
