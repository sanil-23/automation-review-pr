import { NextResponse } from 'next/server';
import path from 'path';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

// New reviewer discover = scout-assign (Cron 1): discover in-scope PRs, assign
// @me, dedup by linked issue, enqueue into the REVIEW QUEUE. (Replaces the
// legacy cron-pr-review.sh full-cycle script.)
const SCOUT_SCRIPT = path.join(triggerJobs.BASE_DIR, 'bin', 'scout-assign');

export async function POST() {
  if (triggerJobs.activeJobs.has('discover')) {
    return NextResponse.json({ error: 'Discovery is already running' }, { status: 409 });
  }

  const logFile = path.join(triggerJobs.LOGS_DIR, `cron-scout.log`);
  const job = triggerJobs.startJob({
    jobId: 'discover',
    command: 'bash',
    args: [SCOUT_SCRIPT],
    logFile,
    type: 'discover',
    pr: null,
    onClose: (code: number) => console.log(`[trigger] scout-assign finished with code ${code}`),
  });

  if (!job) {
    return NextResponse.json({ error: 'Job already running' }, { status: 409 });
  }

  return NextResponse.json({ jobId: 'discover', pid: job.pid, logFile, message: 'Discovery started' });
}
