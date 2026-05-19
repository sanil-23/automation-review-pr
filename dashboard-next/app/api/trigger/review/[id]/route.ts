import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const REVIEW_SCRIPT = path.join(triggerJobs.BASE_DIR, 'review-single.sh');

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);
  const jobId = `review-${prId}`;

  if (triggerJobs.activeJobs.has(jobId)) {
    return NextResponse.json({ error: `Review for PR #${prId} is already running` }, { status: 409 });
  }

  const logFile = path.join(triggerJobs.LOGS_DIR, `review-PR-${prId}-manual-${triggerJobs.timestamp()}.log`);

  const job = triggerJobs.startJob({
    jobId,
    command: 'bash',
    args: [REVIEW_SCRIPT, String(prId)],
    logFile,
    type: 'review',
    pr: prId,
    onClose: (code: number) => {
      // Clear status.json if it still references this PR
      try {
        const sf = path.join(triggerJobs.BASE_DIR, 'status.json');
        const st = JSON.parse(fs.readFileSync(sf, 'utf-8'));
        if (st.pr === prId) fs.writeFileSync(sf, JSON.stringify({ running: false }));
      } catch {}
      console.log(`[trigger] Review of PR #${prId} finished with code ${code}`);
    },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job already running' }, { status: 409 });
  }

  return NextResponse.json({
    jobId,
    pr: prId,
    pid: job.pid,
    logFile,
    message: `Review started for PR #${prId}`,
  });
}
