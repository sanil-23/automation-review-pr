import { Badge } from './Badge';

// FSM state → badge tone, matching the Excalidraw flow colors.
const TONE: Record<string, 'gray' | 'green' | 'red' | 'yellow' | 'purple' | 'blue'> = {
  NEW: 'gray',
  IN_REVIEW: 'blue',
  CHANGES_REQUESTED: 'yellow',
  CLEAN: 'green',
  QUEUED_FOR_FIX: 'yellow',
  FIXING: 'blue',
  AWAIT_CI: 'yellow',
  READY_MERGE: 'green',
  MERGED: 'purple',
  WINNER: 'green',
  CLOSED_LOSER: 'red',
  CLOSED_REDUNDANT: 'red',
  CLOSED: 'gray',
};

export function FsmBadge({ state }: { state?: string }) {
  if (!state) return null;
  return <Badge tone={TONE[state] ?? 'gray'}>{state}</Badge>;
}

export function fsmTone(state?: string) {
  return TONE[state ?? ''] ?? 'gray';
}
