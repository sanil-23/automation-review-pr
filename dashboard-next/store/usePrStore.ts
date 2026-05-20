import { create } from 'zustand';
import { api } from '@/lib/api';
import type { Pr, Stats, FilterOptions, PrFilters } from '@/lib/types';

// --- URL ↔ filter sync helpers ---
const FILTER_KEYS: (keyof PrFilters)[] = [
  'search', 'status', 'author', 'member', 'draft', 'mergeable',
  'review_decision', 'has_review', 'has_findings', 'ci_status',
  'merge_state', 'label', 'include_merged', 'sort', 'order',
  'assignee', 'reviewer', 'is_open',
];

function filtersFromUrl(): PrFilters {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const filters: PrFilters = {};
  for (const key of FILTER_KEYS) {
    const val = params.get(key);
    if (val !== null && val !== '') (filters as any)[key] = val;
  }
  return filters;
}

function filtersToUrl(filters: PrFilters) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null && val !== '') params.set(key, String(val));
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

// --- Client-side filtering (instant) ---
function applyFilters(allPrs: Pr[], filters: PrFilters): Pr[] {
  let out = allPrs;

  if (filters.search) {
    const q = filters.search.toLowerCase();
    out = out.filter((p) =>
      String(p.id).includes(q) ||
      (p.title || '').toLowerCase().includes(q) ||
      (p.author || '').toLowerCase().includes(q) ||
      (p.labels || '').toLowerCase().includes(q),
    );
  }
  if (filters.status) out = out.filter((p) => p.status === filters.status);
  if (filters.author) out = out.filter((p) => p.author === filters.author);
  if (filters.member === '1') out = out.filter((p) => p.is_member);
  if (filters.member === '0') out = out.filter((p) => !p.is_member);
  if (filters.draft === '1') out = out.filter((p) => p.gh_is_draft || p.is_draft);
  if (filters.draft === '0') out = out.filter((p) => !p.gh_is_draft && !p.is_draft);
  if (filters.mergeable) out = out.filter((p) => p.mergeable === filters.mergeable);
  if (filters.review_decision) out = out.filter((p) => p.review_decision === filters.review_decision);
  if (filters.label) {
    const l = filters.label.toLowerCase();
    out = out.filter((p) => (p.labels || '').toLowerCase().includes(l));
  }
  if (filters.has_review === '1') out = out.filter((p) => (p.latest_cycle ?? 0) > 0);
  if (filters.has_review === '0') out = out.filter((p) => (p.latest_cycle ?? 0) === 0);
  if (filters.has_findings === '1') out = out.filter((p) => ((p.findings_critical ?? 0) + (p.findings_major ?? 0) + (p.findings_minor ?? 0)) > 0);
  if (filters.has_findings === '0') out = out.filter((p) => ((p.findings_critical ?? 0) + (p.findings_major ?? 0) + (p.findings_minor ?? 0)) === 0);
  if (filters.ci_status === 'pass') out = out.filter((p) => p.ci_total && p.ci_pass === p.ci_total);
  if (filters.ci_status === 'fail') out = out.filter((p) => (p.ci_fail ?? 0) > 0);
  if (filters.ci_status === 'pending') out = out.filter((p) => (p.ci_pending ?? 0) > 0);
  if (filters.merge_state) out = out.filter((p) => p.merge_state_status === filters.merge_state);
  if (filters.assignee) {
    const a = filters.assignee.toLowerCase();
    out = out.filter((p) => (p.assignees || '').toLowerCase().includes(a));
  }
  if (filters.reviewer) {
    const r = filters.reviewer.toLowerCase();
    out = out.filter((p) => (p.reviewers || '').toLowerCase().includes(r));
  }

  // Sort
  const sort = filters.sort;
  const desc = filters.order !== 'asc';
  if (sort === 'updated') {
    out = [...out].sort((a, b) => ((a.updated_at_gh ?? '') < (b.updated_at_gh ?? '') ? 1 : -1));
  } else if (sort === 'created') {
    out = [...out].sort((a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1));
  } else if (sort === 'findings') {
    const f = (p: Pr) => (p.findings_critical ?? 0) + (p.findings_major ?? 0) + (p.findings_minor ?? 0);
    out = [...out].sort((a, b) => f(b) - f(a));
  } else if (sort === 'cycles') {
    out = [...out].sort((a, b) => (b.latest_cycle ?? 0) - (a.latest_cycle ?? 0));
  }
  // Default sort is by PR # desc (server already returns this), no-op

  if (desc === false && sort) out.reverse();

  return out;
}

// Cache open-pull IDs so we don't re-fetch the slow endpoint on every poll
let _openIdsCache: { ids: Set<number>; at: number } | null = null;
const OPEN_IDS_TTL = 5 * 60 * 1000; // 5 min

interface PrStore {
  allPrs: Pr[];         // unfiltered, from server
  prs: Pr[];            // filtered view (what the table renders)
  stats: Stats | null;
  filterOptions: FilterOptions | null;
  filters: PrFilters;
  loading: boolean;
  error: string | null;
  initFiltersFromUrl: () => void;
  setFilter: (key: keyof PrFilters, value: string | undefined) => void;
  setFilters: (next: Partial<PrFilters>) => void;
  replaceFilters: (next: PrFilters) => void;
  resetFilters: () => void;
  load: () => Promise<void>;
  loadFilterOptions: () => Promise<void>;
}

export const usePrStore = create<PrStore>((set, get) => ({
  allPrs: [],
  prs: [],
  stats: null,
  filterOptions: null,
  filters: {},
  loading: false,
  error: null,

  initFiltersFromUrl: () => {
    const filters = filtersFromUrl();
    set({ filters });
    // Re-apply filters on cached data immediately if we have it
    const { allPrs } = get();
    if (allPrs.length > 0) {
      set({ prs: applyFilters(allPrs, filters) });
    }
  },

  setFilter: (key, value) => {
    const next = { ...get().filters };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value as any;
    set({ filters: next, prs: applyFilters(get().allPrs, next) });
    filtersToUrl(next);
  },

  setFilters: (next) => {
    const merged = { ...get().filters, ...next };
    for (const k of Object.keys(merged) as (keyof PrFilters)[]) {
      if (merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    set({ filters: merged, prs: applyFilters(get().allPrs, merged) });
    filtersToUrl(merged);
  },

  replaceFilters: (next) => {
    set({ filters: next, prs: applyFilters(get().allPrs, next) });
    filtersToUrl(next);
  },

  resetFilters: () => {
    set({ filters: {}, prs: applyFilters(get().allPrs, {}) });
    filtersToUrl({});
  },

  load: async () => {
    set({ loading: true, error: null });
    try {
      const filters = get().filters;
      const needOpen = !filters.include_merged;
      const cacheStale = !_openIdsCache || Date.now() - _openIdsCache.at > OPEN_IDS_TTL;

      // Fetch ALL PRs (no filter params) so we have the full set for client-side filtering
      const [allPrs, stats, openRes] = await Promise.all([
        api.prs({}),
        api.stats(),
        needOpen && cacheStale ? api.openPulls().catch(() => null) : Promise.resolve(null),
      ]);

      if (openRes) {
        _openIdsCache = { ids: new Set(openRes.ids), at: Date.now() };
      }

      const openIds = needOpen ? _openIdsCache?.ids ?? null : null;
      const base = openIds ? allPrs.filter((p) => openIds.has(p.id)) : allPrs;
      const currentFilters = get().filters;
      set({ allPrs: base, prs: applyFilters(base, currentFilters), stats, loading: false });
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
