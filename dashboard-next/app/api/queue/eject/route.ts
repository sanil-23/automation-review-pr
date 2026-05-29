import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';
const pexecFile = promisify(execFile);
const BASE = triggerJobs.BASE_DIR as string;

// POST { pr, reason? } — eject a PR from whichever queue it's in (kills any
// in-flight takeover worker, then moves it to DISMISSED so crons skip it).
export async function POST(req: NextRequest) {
  const { pr, reason } = await req.json().catch(() => ({}));
  if (!pr || !/^\d+$/.test(String(pr))) {
    return NextResponse.json({ error: 'valid pr number required' }, { status: 400 });
  }
  try {
    const { stdout, stderr } = await pexecFile(
      'bash', [path.join(BASE, 'bin', 'queue-eject'), String(pr), String(reason || 'ejected from dashboard')],
      { cwd: BASE },
    );
    return NextResponse.json({ ok: true, pr: Number(pr), message: (stdout || stderr).trim() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
