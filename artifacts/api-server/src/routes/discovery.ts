/**
 * Session signals and ranked discovery.
 *
 * Each signal has its own endpoint so that it can be corrected independently -
 * clearing a query must not clear Picks, and clearing the pivot must not clear
 * either. That independence is a product requirement, not an implementation
 * detail.
 */
import { Router, type IRouter, type Response } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  sessionsTable,
  picksTable,
  negativeSignalsTable,
  interactionsTable,
  type Session,
} from "@workspace/db";
import { catalog } from "../domain/catalog";
import {
  interpret,
  coerceStoredInterpretation,
  type Interpretation,
} from "../domain/interpreter";
import { interpretWithLlm, isLlmConfigured } from "../domain/llm-interpreter";
import { rankForSession } from "../domain/ranking-cache";
import { toBookSummary, shortTitle } from "../domain/serializers";
import { RANKING } from "../domain/config";
import { prepareFilterSession, computeThenCommit, withNegativesCleared } from "../services/filter";
import { assessIntention } from "../domain/assessment";
import {
  createSession,
  findSession,
  touchSession,
  buildSessionState,
  loadSignalIds,
  resetDiscovery,
} from "../services/sessions";

const router: IRouter = Router();

// Only the atomic full-state endpoint may change the experiment's inputs.
// Keep GET /picks compatible (empty); old clients must not create hidden picks
// or commit inputs without corresponding results.
router.use("/session/:sessionId/:signal", (req, res, next) => {
  if (req.method !== "GET" && ["picks", "pivot", "query", "reset"].includes(req.params.signal)) {
    res.status(410).json({ error: "Use POST /api/session/{sessionId}/filter to update the Filter atomically" });
    return;
  }
  next();
});

async function respondWithSession(res: Response, session: Session) {
  res.json(await buildSessionState(session));
}

/** Resolves the session or writes a 404. Returns null when it wrote one. */
async function requireSession(
  sessionId: string,
  res: Response,
): Promise<Session | null> {
  const session = await findSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  return session;
}

router.post("/session", async (_req, res) => {
  const session = await createSession();
  await respondWithSession(res, session);
});

router.get("/session/:sessionId", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;
  await respondWithSession(res, session);
});

router.post("/session/:sessionId/reset", async (req, res) => {
  const existing = await requireSession(req.params.sessionId, res);
  if (!existing) return;
  const session = await resetDiscovery(existing.id);
  await respondWithSession(res, session);
});

router.put("/session/:sessionId/query", async (req, res) => {
  const existing = await requireSession(req.params.sessionId, res);
  if (!existing) return;

  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "Query text is required" });
    return;
  }

  const promptId = req.body?.promptId ?? null;
  const deterministic = interpret(text, promptId);

  // Curated prompts are hard-mapped and must never vary, so only free text is
  // offered to the model - and only here, once, not during ranking. Gating on
  // the resolved source rather than promptId also covers a client that sends a
  // curated query string without its id.
  let interpretation = deterministic;
  if (deterministic.source !== "curated" && isLlmConfigured()) {
    const refined = await interpretWithLlm(text, deterministic);
    if (refined) interpretation = refined;
  }

  await db
    .update(sessionsTable)
    .set({
      query: text,
      queryPromptId: promptId,
      querySource: req.body?.source ?? "freetext",
      queryInterpretation: interpretation,
    })
    .where(eq(sessionsTable.id, existing.id));

  await respondWithSession(res, await touchSession(existing.id));
});

router.delete("/session/:sessionId/query", async (req, res) => {
  const existing = await requireSession(req.params.sessionId, res);
  if (!existing) return;

  // Only the query goes. Picks and the pivot are untouched.
  await db
    .update(sessionsTable)
    .set({
      query: null,
      queryPromptId: null,
      querySource: null,
      queryInterpretation: null,
    })
    .where(eq(sessionsTable.id, existing.id));

  await respondWithSession(res, await touchSession(existing.id));
});

router.get("/session/:sessionId/picks", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;

  const { pickIds } = await loadSignalIds(session.id);
  const items = pickIds
    .map((id) => catalog.byId.get(id))
    .filter((product) => Boolean(product))
    .map((product) => toBookSummary(product!));

  res.json({ items, count: items.length });
});

router.post("/session/:sessionId/picks", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;

  const bookId = String(req.body?.bookId ?? "");
  if (!catalog.byId.has(bookId)) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  await db
    .insert(picksTable)
    .values({ sessionId: session.id, bookId })
    .onConflictDoNothing();

  await respondWithSession(res, await touchSession(session.id));
});

/**
 * Removing a Pick withdraws a positive signal. It is explicitly NOT negative
 * feedback - that lives at /negatives.
 */
router.delete("/session/:sessionId/picks/:bookId", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;

  await db
    .delete(picksTable)
    .where(
      and(
        eq(picksTable.sessionId, session.id),
        eq(picksTable.bookId, req.params.bookId),
      ),
    );

  await respondWithSession(res, await touchSession(session.id));
});

router.delete("/session/:sessionId/picks", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;

  await db.delete(picksTable).where(eq(picksTable.sessionId, session.id));
  await respondWithSession(res, await touchSession(session.id));
});

/** A single active pivot. Setting a new one replaces the old one. */
router.put("/session/:sessionId/pivot", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;

  const bookId = String(req.body?.bookId ?? "");
  if (!catalog.byId.has(bookId)) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  await db
    .update(sessionsTable)
    .set({ pivotBookId: bookId })
    .where(eq(sessionsTable.id, session.id));

  await respondWithSession(res, await touchSession(session.id));
});

router.delete("/session/:sessionId/pivot", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;

  await db
    .update(sessionsTable)
    .set({ pivotBookId: null })
    .where(eq(sessionsTable.id, session.id));

  await respondWithSession(res, await touchSession(session.id));
});

router.post("/session/:sessionId/negatives", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;

  const bookId = String(req.body?.bookId ?? "");
  if (!catalog.byId.has(bookId)) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  await db
    .insert(negativeSignalsTable)
    .values({ sessionId: session.id, bookId })
    .onConflictDoNothing();

  await respondWithSession(res, await touchSession(session.id));
});

router.delete("/session/:sessionId/negatives/:bookId", async (req, res) => {
  const session = await requireSession(req.params.sessionId, res);
  if (!session) return;

  await db
    .delete(negativeSignalsTable)
    .where(
      and(
        eq(negativeSignalsTable.sessionId, session.id),
        eq(negativeSignalsTable.bookId, req.params.bookId),
      ),
    );

  await respondWithSession(res, await touchSession(session.id));
});

router.get("/discover", async (req, res) => {
  const sessionId = String(req.query["sessionId"] ?? "");
  const session = await requireSession(sessionId, res);
  if (!session) return;

  const offset = Math.max(0, Number(req.query["offset"] ?? 0) || 0);
  const limit = Math.min(
    RANKING.maxPageSize,
    Math.max(1, Number(req.query["limit"] ?? RANKING.defaultPageSize) || RANKING.defaultPageSize),
  );

  res.json(await buildDiscoverResponse(session, offset, limit));
});

async function buildDiscoverResponse(
  session: Session,
  offset = 0,
  limit: number = RANKING.defaultPageSize,
  loadedSignals = undefined as Awaited<ReturnType<typeof loadSignalIds>> | undefined,
) {
  loadedSignals ??= await loadSignalIds(session.id);
  const { pickIds, negativeIds } = loadedSignals;

  // Read the interpretation cached when the query was set, recomputing if it
  // is absent or was written by an older build. Ranking never calls the model.
  const interpretation: Interpretation | null = session.query
    ? (coerceStoredInterpretation(session.queryInterpretation) ??
      interpret(session.query, session.queryPromptId))
    : null;

  const ranking = rankForSession(session.id, session.rankingVersion, {
    queryText: session.query,
    interpretation,
    pickIds,
    pivotId: session.pivotBookId,
    negativeIds,
  });

  const page = ranking.outcome.ranked.slice(offset, offset + limit);
  // Reuse the signal rows already loaded for ranking instead of issuing a
  // duplicate Picks/negatives/cart query set for the shaping response.
  const state = await buildSessionState(session, loadedSignals);
  const shaping = state.shaping;

  // Headings adapt to what is actually shaping the results, and never claim
  // that the recommendations got objectively better.
  let heading: string;
  let subheading: string | null = null;

  if (shaping.signalCount === 0) {
    heading = "Books to start with";
    const approximate = Math.round(catalog.size / 100) * 100;
    subheading = `About ${approximate.toLocaleString("en-US")} books for this mode`;
  } else if (
    session.query &&
    pickIds.length === 0 &&
    !session.pivotBookId &&
    negativeIds.length === 0
  ) {
    heading = `Books matching \u201c${session.query}\u201d`;
  } else {
    heading = "Recommended next";
  }

  let notice: string | null = null;
  if (shaping.pivot) {
    notice = `Showing books more like ${shortTitle(shaping.pivot.title)}`;
  } else if (shaping.picks.length > 0) {
    notice = "Results updated from Johnny\u2019s Filter";
  } else if (shaping.negatives.length > 0) {
    notice = `Showing fewer books like ${shortTitle(shaping.negatives[0].title)}`;
  }

  return {
    session: state,
    heading,
    subheading,
    notice,
    announcement: `Results updated. Showing ${page.length} of ${ranking.outcome.ranked.length} books.`,
    results: page.map((entry) => ({
      book: toBookSummary(entry.product),
      score: Number(entry.score.toFixed(4)),
      reason: entry.reason,
    })),
    resultCount: page.length,
    totalAvailable: ranking.outcome.ranked.length,
    hasMore: offset + page.length < ranking.outcome.ranked.length,
    personalized: ranking.outcome.personalized,
    relaxed: ranking.outcome.relaxed,
    relaxedNote: ranking.outcome.relaxed
      ? "We could not find close matches for that. These are other books for this mode."
      : null,
    shaping,
    rankingVersion: session.rankingVersion,
    interpretation: interpretation
      ? {
          themes: interpretation.themes,
          formats: interpretation.formats,
          reduce: interpretation.reduce,
          terms: interpretation.terms,
          seriesHint: interpretation.seriesHint,
          source: interpretation.source,
        }
      : null,
  };
}

router.post("/session/:sessionId/filter", async (req, res) => {
  const body = req.body;
  if (
    !body || typeof body.queryText !== "string" ||
    !(body.pivotWorkId === null || typeof body.pivotWorkId === "string") ||
    body.queryText.length > 2000 ||
    !(body.clearNegatives === undefined || typeof body.clearNegatives === "boolean")
  ) {
    res.status(400).json({ error: "queryText (up to 2000 characters) and pivotWorkId (book ID or null) are required; clearNegatives must be a boolean when present" });
    return;
  }
  if (body.pivotWorkId !== null && !catalog.byId.has(body.pivotWorkId)) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  try {
  const result = await db.transaction(async (tx) => {
    // PostgreSQL row locking serializes updates across processes, not only
    // within this server. No filter state is written until results are ready.
    const [current] = await tx.select().from(sessionsTable)
      .where(eq(sessionsTable.id, req.params.sessionId)).for("update");
    if (!current) return null;
    const loaded = await loadSignalIds(current.id, tx);
    // Context replacement (new intention, Browse all, Open Mode, Start over)
    // clears explicit negatives in the same transaction; Cart is untouched.
    const clearing = body.clearNegatives === true && loaded.negativeIds.length > 0;
    const candidate = withNegativesCleared(await prepareFilterSession(current, body), current, clearing);
    const signals = clearing ? { ...loaded, negativeIds: [] } : loaded;
    return computeThenCommit(
      () => buildDiscoverResponse(candidate, 0, RANKING.defaultPageSize, signals),
      async () => {
        if (clearing) {
          await tx.delete(negativeSignalsTable).where(eq(negativeSignalsTable.sessionId, current.id));
        }
        await tx.update(sessionsTable).set({
          query: candidate.query,
          queryPromptId: candidate.queryPromptId,
          querySource: candidate.querySource,
          queryInterpretation: candidate.queryInterpretation,
          pivotBookId: candidate.pivotBookId,
          rankingVersion: candidate.rankingVersion,
          updatedAt: candidate.updatedAt,
        }).where(eq(sessionsTable.id, current.id));
      },
    );
  });
  if (!result) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(result);
  } catch {
    res.status(500).json({ error: "The Filter change was not applied. Please retry." });
  }
});

/**
 * Read-only scope assessment of a written intention. Deterministic, never
 * calls a model, never writes; clients call it before committing a new
 * context so unsupported requests are never shown as matches.
 */
router.post("/intention/assess", (req, res) => {
  const text = req.body?.text;
  if (typeof text !== "string" || text.length > 2000) {
    res.status(400).json({ error: "text (up to 2000 characters) is required" });
    return;
  }
  res.json(assessIntention(text));
});

router.post("/events", async (req, res) => {
  const sessionId = String(req.body?.sessionId ?? "");
  const name = String(req.body?.name ?? "");

  if (!sessionId || !name) {
    res.status(400).json({ error: "sessionId and name are required" });
    return;
  }

  await db.insert(interactionsTable).values({
    sessionId,
    name,
    bookId: req.body?.bookId ?? null,
    query: req.body?.query ?? null,
    source: req.body?.source ?? null,
  });

  res.json({ ok: true });
});

export default router;
