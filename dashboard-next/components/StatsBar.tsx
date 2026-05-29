'use client';
import type { Stats } from '@/lib/types';
import type { PrFilters } from '@/lib/types';
import { usePrStore } from '@/store/usePrStore';

const cards: Array<{ key: keyof Stats; label: string; filter?: Partial<PrFilters> }> = [
  { key: 'total', label: 'Total' },
  { key: 'under_review', label: 'Under Review', filter: { status: 'under-review' } },
  { key: 'changes_requested', label: 'Changes Req.', filter: { status: 'changes-requested' } },
  { key: 'clean', label: 'Clean', filter: { status: 'clean' } },
  { key: 'blocked', label: 'Blocked', filter: { status: 'blocked' } },
  { key: 'pending', label: 'Pending', filter: { status: 'pending' } },
  { key: 'drafts', label: 'Drafts', filter: { draft: '1' } },
];

export function StatsBar({ stats }: { stats: Stats | null }) {
  const { filters, replaceFilters, resetFilters } = usePrStore();

  const handleClick = (card: typeof cards[number]) => {
    if (!card.filter) {
      resetFilters();
      return;
    }
    const isActive = Object.entries(card.filter).every(([k, v]) => filters[k as keyof PrFilters] === v);
    if (isActive) {
      resetFilters();
    } else {
      replaceFilters(card.filter as PrFilters);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
      {cards.map((card) => {
        const isActive = card.filter && Object.entries(card.filter).every(([k, v]) => filters[k as keyof PrFilters] === v);
        return (
          <button
            key={card.key}
            onClick={() => handleClick(card)}
            className={
              'rounded border px-3 py-2 text-left transition-colors cursor-pointer ' +
              (isActive
                ? 'border-[var(--color-accent)] bg-blue-500/15'
                : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)]')
            }
          >
            <div className="text-xs text-[var(--color-text-muted)]">{card.label}</div>
            <div className="text-xl font-semibold mt-0.5">{(stats?.[card.key] as number | undefined) ?? '-'}</div>
          </button>
        );
      })}
    </div>
  );
}
