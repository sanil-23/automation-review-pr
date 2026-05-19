import { create } from 'zustand';
import { api, gh } from '@/lib/api';
import type { Pr, Stats, FilterOptions, PrFilters } from '@/lib/types';

interface PrStore {
  prs: Pr[];
  stats: Stats | null;
  filterOptions: FilterOptions | null;
  filters: PrFilters;
  loading: boolean;
  error: string | null;
  setFilter: (key: keyof PrFilters, value: string | undefined) => void;
  setFilters: (next: Partial<PrFilters>) => void;
  resetFilters: () => void;
  load: () => Promise<void>;
  loadFilterOptions: () => Promise<void>;
}

export const usePrStore = create<PrStore>((set, get) => ({
  prs: [],
  stats: null,
  filterOptions: null,
  filters: {},
  loading: false,
  error: null,

  setFilter: (key, value) => {
    const next = { ...get().filters };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value as any;
    set({ filters: next });
    get().load();
  },

  setFilters: (next) => {
    set({ filters: { ...get().filters, ...next } });
    get().load();
  },

  resetFilters: () => {
    set({ filters: {} });
    get().load();
  },

  load: async () => {
    set({ loading: true, error: null });
    try {
      // Hit the local DB and GitHub's public open-PR list in parallel.
      // The local DB may still hold PRs that have been merged/closed on GitHub
      // (e.g. tracking file in `already-merged/` but its `**Status**: clean`
      // line outranks the location signal during parsing). We trust GitHub for
      // open-state and filter accordingly unless include_merged is set.
      const filters = get().filters;
      const [prs, stats, openIds] = await Promise.all([
        api.prs(filters),
        api.stats(),
        filters.include_merged ? Promise.resolve(null) : gh.openPullNumbers().catch(() => null),
      ]);
      const filtered = openIds ? prs.filter((p) => openIds.has(p.id)) : prs;
      set({ prs: filtered, stats, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  loadFilterOptions: async () => {
    try {
      const filterOptions = await api.filters();
      set({ filterOptions });
    } catch {}
  },
}));
