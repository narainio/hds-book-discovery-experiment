/**
 * Candidate generation, scoring, diversification and grounded explanation.
 *
 * S(p) = wq*Q + wc*C + wb*B + wm*M + we*E - wn*N
 *
 * Every weight and cap lives in config.ts. Every explanation is produced from a
 * reason code plus real catalog fields, never from free-form prose.
 */
import { catalog, type IndexedProduct } from "./catalog";
import type { Interpretation } from "./interpreter";
import { queryLabel, buildTermMatcher } from "./interpreter";
import { shortTitle } from "./serializers";
import {
  WEIGHTS,
  RANKING,
  REASON_TEMPLATES,
  REDUCE_CONCEPT_TERMS,
  type ReasonCode,
} from "./config";

export type Signals = {
  queryText: string | null;
  interpretation: Interpretation | null;
  pickIds: string[];
  pivotId: string | null;
  negativeIds: string[];
};

export type Reason = {
  code: ReasonCode;
  text: string;
  sourceBookId: string | null;
  matchedSubjects: string[];
};

export type ScoredBook = {
  product: IndexedProduct;
  score: number;
  reason: Reason | null;
};

export type RankingOutcome = {
  ranked: ScoredBook[];
  personalized: boolean;
  /** True when a query was given but nothing in the catalog really matched it. */
  relaxed: boolean;
};

type Profile = {
  interpretation: Interpretation | null;
  queryVector: Map<string, number> | null;
  queryText: string | null;
  picks: IndexedProduct[];
  pickIdSet: Set<string>;
  pivot: IndexedProduct | null;
  negatives: IndexedProduct[];
  negativeIdSet: Set<string>;
  /** Precompiled once per request rather than per product. */
  reduceMatchers: RegExp[];
};

function buildProfile(signals: Signals): Profile {
  // This bounded experiment has one example, never a hidden multi-pick profile.
  const picks: IndexedProduct[] = [];

  const negatives = signals.negativeIds
    .map((id) => catalog.byId.get(id))
    .filter((product): product is IndexedProduct => Boolean(product));

  const pivot = signals.pivotId
    ? (catalog.byId.get(signals.pivotId) ?? null)
    : null;

  const interpretation = signals.interpretation;

  // The query vector blends the parent's own words with the vocabulary of any
  // themes and formats we recognized, so "funny mysteries" also pulls in the
  // catalog's own subject wording.
  let queryVector: Map<string, number> | null = null;
  if (interpretation) {
    const terms = [
      ...interpretation.terms,
      ...interpretation.themes.flatMap((theme) => theme.toLowerCase().split(/[^a-z]+/)),
      ...interpretation.formats.flatMap((format) => format.toLowerCase().split(/[^a-z]+/)),
    ].filter((term) => term.length > 1);
    queryVector = terms.length > 0 ? catalog.vectorFromTerms(terms) : null;
  }

  // Interpretations can arrive from the model or an older session row, so an
  // unrecognised concept is tolerated here rather than trusted as a key.
  const conceptTerms: Record<string, string[] | undefined> =
    REDUCE_CONCEPT_TERMS;
  const reduceTerms = new Set<string>();
  for (const concept of interpretation?.reduce ?? []) {
    for (const term of conceptTerms[concept] ?? []) {
      reduceTerms.add(term);
    }
  }
  const reduceMatchers = [...reduceTerms].map((term) =>
    buildTermMatcher(term, true),
  );

  return {
    interpretation,
    queryVector,
    queryText: signals.queryText,
    picks,
    pickIdSet: new Set(picks.map((product) => product.id)),
    pivot,
    negatives,
    negativeIdSet: new Set(negatives.map((product) => product.id)),
    reduceMatchers,
  };
}

/** Q: how well the product answers the stated direction. */
function queryScore(product: IndexedProduct, profile: Profile): number {
  const { interpretation, queryVector } = profile;
  if (!interpretation) return 0;

  let score = queryVector
    ? catalog.similarity(queryVector, product.vector) * 2.2
    : 0;

  for (const theme of interpretation.themes) {
    if (product.topSubjectSet.has(theme)) {
      score += 0.28;
      continue;
    }
    // Themes may also name a deeper node in the subject path.
    if (product.subjects.some((subject) => subject.includes(theme))) {
      score += 0.18;
    }
  }

  for (const format of interpretation.formats) {
    if (product.tagSet.has(format)) score += 0.22;
  }

  if (
    interpretation.seriesHint &&
    product.seriesName &&
    product.seriesName.toLowerCase().includes(interpretation.seriesHint.toLowerCase())
  ) {
    score += 0.7;
  }

  // Honour what the parent asked to see less of.
  if (profile.reduceMatchers.length > 0) {
    let hits = 0;
    for (const matcher of profile.reduceMatchers) {
      if (matcher.test(product.searchText)) hits += 1;
    }
    if (hits > 0) score -= Math.min(0.5, 0.18 * hits);
  }

  return Math.max(0, Math.min(1.4, score));
}

/** C: closeness to the books already collected in Johnny's Picks. */
function picksScore(
  product: IndexedProduct,
  profile: Profile,
): { score: number; bestPick: IndexedProduct | null; bestSimilarity: number } {
  if (profile.picks.length === 0) {
    return { score: 0, bestPick: null, bestSimilarity: 0 };
  }

  let best = 0;
  let bestPick: IndexedProduct | null = null;
  let supporting = 0;

  for (const pick of profile.picks) {
    if (pick.id === product.id) continue;
    const similarity = catalog.similarity(pick.vector, product.vector);
    if (similarity > best) {
      best = similarity;
      bestPick = pick;
    }
    if (similarity >= RANKING.similarityFloor) supporting += 1;
  }

  // Agreement across several Picks is a stronger signal than one close match.
  const consensus = supporting / profile.picks.length;
  return {
    score: Math.min(1, best * 2.4 + consensus * 0.2),
    bestPick,
    bestSimilarity: best,
  };
}

/** M: closeness to the single active "More like this" pivot. */
function pivotScore(
  product: IndexedProduct,
  profile: Profile,
): { score: number; similarity: number } {
  if (!profile.pivot) return { score: 0, similarity: 0 };

  const similarity = catalog.similarity(profile.pivot.vector, product.vector);
  let score = similarity * 2.4;

  if (
    profile.pivot.seriesName &&
    product.seriesName === profile.pivot.seriesName
  ) {
    score += 0.5;
  }

  return { score: Math.min(1.3, score), similarity };
}

/** B: a mild catalog quality prior so ties break sensibly. */
function baseScore(product: IndexedProduct): number {
  const quality = product.bookScore !== null ? product.bookScore / 10 : 0.5;
  const awards = Math.min(product.awardCount / 3, 1);
  return 0.75 * quality + 0.25 * awards;
}

/** E: editorial affinity with the Picks - shared shelf, not shared wording. */
function editorialScore(
  product: IndexedProduct,
  profile: Profile,
): { score: number; sharedSubjects: string[]; seriesPick: IndexedProduct | null } {
  if (profile.picks.length === 0) {
    return { score: 0, sharedSubjects: [], seriesPick: null };
  }

  let seriesPick: IndexedProduct | null = null;
  const sharedSubjects = new Set<string>();
  let sharedTagCount = 0;

  for (const pick of profile.picks) {
    if (pick.id === product.id) continue;

    if (pick.seriesName && pick.seriesName === product.seriesName) {
      seriesPick = pick;
    }
    for (const subject of pick.topSubjectSet) {
      if (product.topSubjectSet.has(subject)) sharedSubjects.add(subject);
    }
    for (const tag of pick.tagSet) {
      if (product.tagSet.has(tag)) sharedTagCount += 1;
    }
  }

  if (seriesPick) {
    return { score: 1, sharedSubjects: [...sharedSubjects], seriesPick };
  }

  const subjectAffinity = Math.min(sharedSubjects.size / 2, 1);
  const tagAffinity = Math.min(sharedTagCount / 3, 1);
  return {
    score: 0.7 * subjectAffinity + 0.3 * tagAffinity,
    sharedSubjects: [...sharedSubjects],
    seriesPick: null,
  };
}

/** N: closeness to anything the parent explicitly pushed away. */
function negativeScore(product: IndexedProduct, profile: Profile): number {
  if (profile.negatives.length === 0) return 0;

  let worst = 0;
  for (const negative of profile.negatives) {
    let similarity = catalog.similarity(negative.vector, product.vector) * 2.2;
    if (negative.seriesName && negative.seriesName === product.seriesName) {
      similarity += 0.6;
    }
    worst = Math.max(worst, similarity);
  }
  return Math.min(1.3, worst);
}

function pickReason(
  product: IndexedProduct,
  profile: Profile,
  parts: {
    query: number;
    pivotSimilarity: number;
    pickSimilarity: number;
    bestPick: IndexedProduct | null;
    seriesPick: IndexedProduct | null;
    sharedSubjects: string[];
  },
): Reason | null {
  // The pivot is the most explicit thing the parent asked for, so it wins.
  if (profile.pivot && parts.pivotSimilarity >= RANKING.similarityFloor) {
    return {
      code: "SIMILAR_TO_PIVOT",
      text: REASON_TEMPLATES.SIMILAR_TO_PIVOT(shortTitle(profile.pivot.title)),
      sourceBookId: profile.pivot.id,
      matchedSubjects: [],
    };
  }

  if (parts.seriesPick && product.seriesName) {
    return {
      code: "SAME_SERIES_AS_PICK",
      text: REASON_TEMPLATES.SAME_SERIES_AS_PICK(product.seriesName),
      sourceBookId: parts.seriesPick.id,
      matchedSubjects: [],
    };
  }

  if (parts.bestPick && parts.pickSimilarity >= RANKING.minReasonStrength) {
    return {
      code: "SIMILAR_TO_PICK",
      text: REASON_TEMPLATES.SIMILAR_TO_PICK(shortTitle(parts.bestPick.title)),
      sourceBookId: parts.bestPick.id,
      matchedSubjects: [],
    };
  }

  if (profile.queryText && parts.query >= RANKING.minReasonStrength) {
    return {
      code: "MATCHES_QUERY",
      text: REASON_TEMPLATES.MATCHES_QUERY(queryLabel(profile.queryText)),
      sourceBookId: null,
      matchedSubjects: [],
    };
  }

  if (parts.sharedSubjects.length > 0) {
    const subject = parts.sharedSubjects[0];
    return {
      code: "SHARED_SUBJECTS",
      text: REASON_TEMPLATES.SHARED_SUBJECTS(subject.toLowerCase()),
      sourceBookId: null,
      matchedSubjects: parts.sharedSubjects,
    };
  }

  // Better to say nothing than to show a weak reason.
  return null;
}

/**
 * Caps repetition within a sliding window so the grid never turns into one
 * series or one subject, without hiding genuinely relevant results entirely.
 */
function diversify(ranked: ScoredBook[]): ScoredBook[] {
  const selected: ScoredBook[] = [];
  const deferred: ScoredBook[] = [];

  const violatesCaps = (candidate: ScoredBook): boolean => {
    const window = selected.slice(-RANKING.diversityWindow);

    if (candidate.product.seriesName) {
      const seriesCount = window.filter(
        (entry) => entry.product.seriesName === candidate.product.seriesName,
      ).length;
      if (seriesCount >= RANKING.maxPerSeriesInWindow) return true;
    }

    const primarySubject = candidate.product.topSubjects[0];
    if (primarySubject) {
      const subjectCount = window.filter(
        (entry) => entry.product.topSubjects[0] === primarySubject,
      ).length;
      if (subjectCount >= RANKING.maxPerSubjectInWindow) return true;
    }

    return false;
  };

  for (const candidate of ranked) {
    if (violatesCaps(candidate)) {
      deferred.push(candidate);
    } else {
      selected.push(candidate);
    }
  }

  // Deferred items still belong in the catalog, just further down.
  return [...selected, ...deferred];
}

export function rank(signals: Signals): RankingOutcome {
  const profile = buildProfile(signals);
  const personalized = Boolean(
    profile.interpretation || profile.picks.length > 0 || profile.pivot,
  );

  const scored: ScoredBook[] = [];
  let maxQuery = 0;

  for (const product of catalog.products) {
    // Explicit negatives retain their existing eligibility rule. An example
    // remains an ordinary candidate, not a required match or a pinned result.
    if (profile.negativeIdSet.has(product.id)) continue;

    const query = queryScore(product, profile);
    const picks = picksScore(product, profile);
    const pivot = pivotScore(product, profile);
    const editorial = editorialScore(product, profile);
    const negative = negativeScore(product, profile);

    if (query > maxQuery) maxQuery = query;

    let score =
      WEIGHTS.query * query +
      WEIGHTS.picks * picks.score +
      WEIGHTS.base * baseScore(product) +
      WEIGHTS.pivot * pivot.score +
      WEIGHTS.editorial * editorial.score -
      WEIGHTS.negative * negative;

    if (profile.pickIdSet.has(product.id)) {
      score -= RANKING.pickedBookDemotion;
    }

    if (product.isSpanishEdition) {
      score -= RANKING.spanishEditionDemotion;
    }

    const reason = personalized
      ? pickReason(product, profile, {
          query,
          pivotSimilarity: pivot.similarity,
          pickSimilarity: picks.bestSimilarity,
          bestPick: picks.bestPick,
          seriesPick: editorial.seriesPick,
          sharedSubjects: editorial.sharedSubjects,
        })
      : null;

    scored.push({ product, score, reason });
  }

  scored.sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title));

  const relaxed = Boolean(
    profile.interpretation && maxQuery < RANKING.weakQueryThreshold,
  );

  return { ranked: diversify(scored), personalized, relaxed };
}
