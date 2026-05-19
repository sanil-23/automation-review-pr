import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { db, githubSync, triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const REPO = 'tinyhumansai/openhuman';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);

  const pr = db.getPrByIdFull ? db.getPrByIdFull(prId) : db.getPrById(prId);
  if (!pr) return NextResponse.json({ error: 'PR not found' }, { status: 404 });

  const eligible = pr.status === 'approved' || pr.status === 'clean' || pr.review_decision === 'APPROVED';
  if (!eligible) {
    return NextResponse.json({ error: `PR #${prId} is not eligible for merge (status: ${pr.status})` }, { status: 400 });
  }

  try {
    const out = execSync(
      `gh pr merge ${prId} --repo ${REPO} --squash --delete-branch`,
      { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    console.log(`[trigger] PR #${prId} merged successfully`);

    githubSync.handlePrMerged(prId);

    fs.mkdirSync(triggerJobs.LOGS_DIR, { recursive: true });
    const logFile = path.join(triggerJobs.LOGS_DIR, `merge-PR-${prId}-${triggerJobs.timestamp()}.log`);
    fs.writeFileSync(logFile, `[${new Date().toISOString()}] PR #${prId} merged via squash\n${out || ''}\n`);

    return NextResponse.json({ success: true, message: `PR #${prId} merged` });
  } catch (err: any) {
    console.error(`[trigger] Merge of PR #${prId} failed: ${err.message}`);
    return NextResponse.json({ error: `Merge failed: ${err.stderr || err.message}` }, { status: 500 });
  }
}
