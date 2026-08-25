import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Counts rendered as badges beside the console's sidebar items.
 *
 * Keys are AdminPage keys so the nav can look a count up by the page it links to. Anything
 * absent (or zero) renders no badge — a badge is a call to act, so a zero badge is noise.
 */
export type AdminBadgeCounts = Partial<Record<'orders' | 'returns' | 'unsold' | 'reviews', number>>;

// The console is a long-lived tab on a shop floor; refresh often enough that a badge is
// trustworthy, rarely enough that an idle tab is not hammering the dashboard aggregate.
const REFRESH_MS = 60_000;

function toCount(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

const NO_BADGES: AdminBadgeCounts = {};

export function useAdminBadges(enabled: boolean): { counts: AdminBadgeCounts; refresh: () => void } {
  const [counts, setCounts] = useState<AdminBadgeCounts>(NO_BADGES);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await api.admin.dashboard() as { kpis?: Record<string, unknown> };
      const kpis = data?.kpis || {};
      setCounts({
        orders: toCount(kpis.open_orders),
        returns: toCount(kpis.open_returns),
        unsold: toCount(kpis.unsold_alerts),
        reviews: toCount(kpis.unpublished_reviews),
      });
    } catch {
      // Badges are an affordance, not a feature: a failed poll leaves the last known counts
      // rather than blanking the nav or surfacing an error the operator cannot act on.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Deferred off the effect body for the same reason the admin screens do it: the poll
    // writes state, and running it synchronously here trips react-hooks/set-state-in-effect.
    void Promise.resolve().then(load);
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  // Derived rather than cleared in an effect: signing out should hide the counts on the very
  // render that flips `enabled`, not one cascading render later.
  return { counts: enabled ? counts : NO_BADGES, refresh: () => { void load(); } };
}
