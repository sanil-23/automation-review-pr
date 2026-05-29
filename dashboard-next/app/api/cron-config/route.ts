import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { triggerJobs, scheduler } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const BASE = triggerJobs.BASE_DIR as string;
const CFG = path.join(BASE, 'cron-config.json');
const DEFAULTS = { enabled: true, scout: '*/20 * * * *', review: '*/30 * * * *', stall: '0 * * * *' };

function readCfg() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
// Whether an OS crontab copy is also installed (informational — the in-process
// scheduler is what actually runs the crons when the dashboard is up).
function crontabInstalled() {
  try { return execFileSync('crontab', ['-l']).toString().includes('pr-reviewer-takeover'); }
  catch { return false; }
}
function validCron(e: unknown) {
  return typeof e === 'string' && e.trim().split(/\s+/).length === 5;
}

export function GET() {
  const st = scheduler.getState();
  return NextResponse.json({ config: readCfg(), scheduler: st, crontabInstalled: crontabInstalled() });
}

// Writing cron-config.json is enough — the in-process scheduler re-reads it on
// the next tick (no restart, no crontab edit).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cur = readCfg();
  const next = {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : cur.enabled,
    scout: validCron(body.scout) ? body.scout.trim() : cur.scout,
    review: validCron(body.review) ? body.review.trim() : cur.review,
    stall: validCron(body.stall) ? body.stall.trim() : cur.stall,
  };
  fs.writeFileSync(CFG, JSON.stringify(next, null, 2) + '\n');
  return NextResponse.json({ config: next, scheduler: scheduler.getState(), crontabInstalled: crontabInstalled() });
}
