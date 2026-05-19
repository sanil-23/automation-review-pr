import { NextResponse } from 'next/server';
import path from 'path';
import { triggerJobs, tmux } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const prId = parseInt(idStr, 10);

  if (!tmux.isAvailable()) {
    return NextResponse.json({ error: 'tmux not installed on the server' }, { status: 500 });
  }
  if (tmux.isFixRunning(prId)) {
    return NextResponse.json({ error: `Fix for PR #${prId} is already running` }, { status: 409 });
  }

  const logFile = path.join(triggerJobs.LOGS_DIR, `fix-PR-${prId}-tmux-${triggerJobs.timestamp()}.log`);

  try {
    const info = tmux.startFixInPane(prId, logFile);
    return NextResponse.json({
      pr: prId,
      session: info.session,
      window: info.window,
      pane_id: info.pane_id,
      workspace: info.workspace,
      attach: info.attach,
      logFile: info.logFile,
      message: `Fix for PR #${prId} sent to ${info.workspace} (${info.session}:${info.window})`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
