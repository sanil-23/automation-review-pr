import { NextResponse } from 'next/server';
import { db, tmux } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

// Active takeover workers, one row per occupied slot, enriched with whether a
// live tmux fix window is mirroring it.
export async function GET() {
  const concurrency = Number(process.env.TAKEOVER_CONCURRENCY || 5);
  const workers = db.takeoverWorkers().map((w: any) => ({
    ...w,
    tmux_window: tmux.hasWindow?.(w.pr_id) ? `${tmux.SESSION}:pr-${w.pr_id}` : null,
  }));
  return NextResponse.json({ concurrency, workers });
}
