import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

// POST { job: "scout" | "review" | "stall" } — fire a cron immediately.
export async function POST(req: NextRequest) {
  const { job } = await req.json().catch(() => ({}));
  if (!['scout', 'review', 'stall'].includes(job)) {
    return NextResponse.json({ error: 'job must be scout|review|stall' }, { status: 400 });
  }
  const started = scheduler.runNow(job);
  return NextResponse.json({ ok: started, job, message: started ? 'started' : 'already running' });
}
