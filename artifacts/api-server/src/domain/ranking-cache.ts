import { rank, type RankingOutcome, type Signals } from "./ranking";

type CacheEntry = {
  signature: string;
  expiresAt: number;
  outcome: RankingOutcome;
};

/**
 * A ranking outcome contains references to the immutable in-memory catalog,
 * plus scores and reasons. Keep only one recent outcome per anonymous session
 * and cap the session count so the prototype cannot grow without bound.
 */
const cache = new Map<string, CacheEntry>();
const MAX_SESSIONS = 24;
const TTL_MS = 2 * 60 * 1000;

function signatureFor(rankingVersion: number, signals: Signals): string {
  return JSON.stringify({
    rankingVersion,
    queryText: signals.queryText,
    interpretation: signals.interpretation,
    pickIds: signals.pickIds,
    pivotId: signals.pivotId,
    negativeIds: signals.negativeIds,
  });
}

function remember(sessionId: string, entry: CacheEntry) {
  cache.delete(sessionId);
  cache.set(sessionId, entry);

  while (cache.size > MAX_SESSIONS) {
    const oldestSessionId = cache.keys().next().value;
    if (typeof oldestSessionId !== "string") break;
    cache.delete(oldestSessionId);
  }
}

export function rankForSession(
  sessionId: string,
  rankingVersion: number,
  signals: Signals,
): { outcome: RankingOutcome; cacheStatus: "hit" | "miss" } {
  const signature = signatureFor(rankingVersion, signals);
  const existing = cache.get(sessionId);

  if (
    existing &&
    existing.signature === signature &&
    existing.expiresAt > Date.now()
  ) {
    // Refresh insertion order so the bounded Map behaves as an LRU.
    remember(sessionId, existing);
    return { outcome: existing.outcome, cacheStatus: "hit" };
  }

  const outcome = rank(signals);
  remember(sessionId, {
    signature,
    expiresAt: Date.now() + TTL_MS,
    outcome,
  });
  return { outcome, cacheStatus: "miss" };
}