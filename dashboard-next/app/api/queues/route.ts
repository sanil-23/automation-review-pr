import { NextResponse } from 'next/server';
import { db } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

// The two-queue board: { review: [...], fix: [...], issueGroups: [...], counts }.
export async function GET() {
  const { review, fix } = db.queues();
  return NextResponse.json({
    review,
    fix,
    issueGroups: db.issueGroups(),
    counts: db.fsmCounts(),
  });
}
