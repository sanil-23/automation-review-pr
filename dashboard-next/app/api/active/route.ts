import { NextResponse } from 'next/server';
import fs from 'fs';
import { db, scheduler } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

// PRs with a live review-single process (review-single.sh writes
// /tmp/review-pr-<N>.pid while it runs). Liveness checked via kill(pid, 0).
function activeReviews(): number[] {
  const out: number[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync('/tmp'); } catch { return out; }
  for (const f of files) {
    const m = f.match(/^review-pr-(\d+)\.pid$/);
    if (!m) continue;
    try {
      const pid = parseInt(fs.readFileSync(`/tmp/${f}`, 'utf8').trim(), 10);
      process.kill(pid, 0);           // throws if the process is gone
      out.push(Number(m[1]));
    } catch { /* stale pid — skip */ }
  }
  return out;
}

export function GET() {
  const reviewing = activeReviews();
  const takeover = db.takeoverWorkers().map((w: any) => w.pr_id);
  // which crons are mid-run (scout/review/stall)
  const jobs = scheduler.getState().jobs as Record<string, { running: boolean }>;
  const crons = Object.entries(jobs).filter(([, v]) => v.running).map(([k]) => k);
  return NextResponse.json({ reviewing, takeover, crons });
}
