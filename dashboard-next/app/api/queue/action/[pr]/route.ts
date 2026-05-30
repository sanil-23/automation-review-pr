import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';
const pexecFile = promisify(execFile);
const BASE = triggerJobs.BASE_DIR as string;
const ACTIONS = ['approve', 'close', 'requeue', 'confirm-close', 'takeover'];

// POST /api/queue/action/<pr>  { action }
export async function POST(req: NextRequest, { params }: { params: Promise<{ pr: string }> }) {
  const { pr } = await params;
  const { action } = await req.json().catch(() => ({}));
  if (!/^\d+$/.test(pr)) return NextResponse.json({ error: 'bad pr' }, { status: 400 });
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: `action must be one of ${ACTIONS.join('|')}` }, { status: 400 });
  try {
    const { stdout, stderr } = await pexecFile('bash', [path.join(BASE, 'bin', 'queue-action'), action, pr], { cwd: BASE });
    return NextResponse.json({ ok: true, pr: Number(pr), action, message: (stdout || stderr).trim() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, action, error: (e.stderr || e.message || '').toString().trim() }, { status: 500 });
  }
}
