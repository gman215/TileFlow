import { useEffect, useState } from 'react';
import type { AiHealthDTO } from '@api/_lib/types';
import { ai } from '../api/ai';

/**
 * Whether this deployment can talk to Gemini.
 *
 * Every AI entry point consults this so it can render disabled with a reason,
 * rather than failing on click (AC-6.4, AC-7.3). The result is cached in module
 * scope: it cannot change without a redeploy, and several panels ask at once.
 */

export interface AiAvailability {
  configured: boolean;
  demoMode: boolean;
  loading: boolean;
  /** Human-readable explanation when AI is unavailable, else null. */
  reason: string | null;
}

const UNAVAILABLE: AiHealthDTO = {
  configured: false,
  demoMode: false,
  models: { fast: '', vision: '' },
};

let cached: AiHealthDTO | null = null;
let inflight: Promise<AiHealthDTO> | null = null;

/**
 * Fetch health at most once per page load.
 *
 * The in-flight promise is shared as well as the result, so N components
 * mounting in the same tick produce one request rather than N. A failed probe
 * resolves to "unavailable" instead of rejecting: an unreachable health route
 * and an unconfigured one mean the same thing to the UI.
 */
export function loadAiHealth(): Promise<AiHealthDTO> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = ai
    .health()
    .catch(() => UNAVAILABLE)
    .then((health) => {
      cached = health;
      inflight = null;
      return health;
    });

  return inflight;
}

/** Test seam — clears the module-scope cache. */
export function resetAiHealthCache(): void {
  cached = null;
  inflight = null;
}

function reasonFor(health: AiHealthDTO): string | null {
  if (!health.configured) return 'AI features are not configured on this deployment.';
  if (health.demoMode) return "Today's AI budget is spent — showing example output.";
  return null;
}

export function useAiAvailability(): AiAvailability {
  const [health, setHealth] = useState<AiHealthDTO | null>(cached);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    // No state update after unmount — the same discipline useLayoutWorker applies.
    loadAiHealth().then((h) => {
      if (alive) setHealth(h);
    });
    return () => {
      alive = false;
    };
  }, []);

  return {
    configured: health?.configured ?? false,
    demoMode: health?.demoMode ?? false,
    loading: health === null,
    reason: health ? reasonFor(health) : null,
  };
}
