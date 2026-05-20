'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Section } from './Section';
import { Badge } from './Badge';

export function LiveReviewLog({ prId, isRunning }: { prId: number; isRunning: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const seenRef = useRef(0);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!isRunning && !visible) return;

    let cancelled = false;
    const jobId = `review-${prId}`;

    const poll = async () => {
      try {
        const data = await api.jobLog(jobId, seenRef.current);
        if (cancelled) return;
        if (data.lines.length > 0) {
          setLines((prev) => [...prev, ...data.lines]);
          seenRef.current = data.total;
          setVisible(true);
        }
        setElapsed(Math.round((Date.now() - startTime) / 1000));
        if (data.done) {
          setDone(true);
          setExitCode(data.exitCode);
        }
      } catch {
        // Job not found — hide if we never got lines
        if (!visible) return;
      }
    };

    poll();
    const interval = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [prId, isRunning, visible, startTime]);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [lines]);

  if (!visible) return null;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <Section
      title="Live Review Output"
      badge={
        done ? (
          exitCode === 0
            ? <Badge tone="green">Completed</Badge>
            : <Badge tone="red">Failed (exit {exitCode})</Badge>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-yellow-500">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
            </span>
            Running…
          </span>
        )
      }
    >
      <pre
        ref={preRef}
        className="bg-black/40 border border-[var(--color-border)] rounded p-3 text-xs leading-snug font-mono max-h-[480px] overflow-auto whitespace-pre-wrap break-words"
      >
        {lines.length > 0 ? lines.join('\n') : '(waiting for output…)'}
      </pre>
      <div className="mt-1.5 text-xs text-[var(--color-text-muted)]">
        {seenRef.current} lines | {duration}
        {done && (exitCode === 0 ? ' | Review posted' : ' | Check logs for errors')}
      </div>
    </Section>
  );
}
