import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';
const pexecFile = promisify(execFile);
const BASE = triggerJobs.BASE_DIR as string;

// GET — gh/git identity consistency (the same check the startup preflight runs).
export async function GET() {
  try {
    const { stdout } = await pexecFile('bash', [path.join(BASE, 'bin', 'identity-check'), '--json'], { cwd: BASE });
    return NextResponse.json(JSON.parse(stdout));
  } catch (e: any) {
    // identity-check exits non-zero on mismatch but still prints JSON on stdout.
    if (e.stdout) { try { return NextResponse.json(JSON.parse(e.stdout)); } catch {} }
    return NextResponse.json({ ok: false, problems: [e.message] }, { status: 200 });
  }
}
