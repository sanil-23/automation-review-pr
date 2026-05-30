import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';
const BASE = triggerJobs.BASE_DIR as string;

// POST /api/queue/review/<pr> — review a single PR now (detached; review takes
// minutes). Returns immediately; the FSM state updates when it finishes.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ pr: string }> }) {
  const { pr } = await params;
  if (!/^\d+$/.test(pr)) return NextResponse.json({ error: 'bad pr' }, { status: 400 });

  fs.mkdirSync(path.join(BASE, 'logs'), { recursive: true });
  const out = fs.openSync(path.join(BASE, 'logs', `review-one-${pr}.log`), 'a');
  const child = spawn('bash', [path.join(BASE, 'bin', 'review-one'), pr], {
    cwd: BASE, env: { ...process.env }, stdio: ['ignore', out, out], detached: true,
  });
  child.unref();
  return NextResponse.json({ ok: true, pr: Number(pr), pid: child.pid, message: 'review started' });
}
