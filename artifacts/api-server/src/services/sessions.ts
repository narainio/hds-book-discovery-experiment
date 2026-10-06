/**
 * Session state: the signals that shape discovery, and the assembled view of
 * them that the "Shaping these results" control renders.
 *
 * Picks and Cart are deliberately separate collections here. A Pick is a
 * discovery signal; a cart line is purchase intent. Removing a Pick is not
 * negative feedback - that is a distinct table.
 */
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  db,
  sessionsTable,
  picksTable,
  negativeSignalsTable,
  cartItemsTable,
  type Session,
} from "@workspace/db";
import { MODE } from "../domain/config";
import { catalog } from "../domain/catalog";
import {
  toBookThumb,
  shortTitle,
  type BookThumbDto,
} from "../domain/serializers";

export type ShapingStateDto = {
  modeLabel: string;
  query: string | null;
  pivot: BookThumbDto | null;
  picks: BookThumbDto[];
  negatives: BookThumbDto[];
  hasSignals: boolean;
  signalCount: number;
  summaryText: string;
};

export type SessionStateDto = {
  sessionId: string;
  modeId: string;
  modeLabel: string;
  gradeLabel: string;
  query: string | null;
  pickCount: number;
  cartCount: number;
  negativeCount: number;
  pickIds: string[];
  cartIds: string[];
  negativeIds: string[];
  pivotId: string | null;
  shaping: ShapingStateDto;
  rankingVersion: number;
};

export async function createSession(): Promise<Session> {
  const [session] = await db
    .insert(sessionsTable)
    .values({ id: randomUUID(), modeId: MODE.id })
    .returning();
  return session;
}

export async function findSession(sessionId: string): Promise<Session | null> {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  return session ?? null;
}

/**
 * Every signal change bumps rankingVersion so the client can tell that results
 * were re-ranked rather than merely refetched.
 */
export async function touchSession(sessionId: string): Promise<Session> {
  const current = await findSession(sessionId);
  const [session] = await db
    .update(sessionsTable)
    .set({
      rankingVersion: (current?.rankingVersion ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(sessionsTable.id, sessionId))
    .returning();
  return session;
}

export async function loadSignalIds(sessionId: string, reader: Pick<typeof db, "select"> = db) {
  const [negatives, cart] = await Promise.all([
    reader
      .select()
      .from(negativeSignalsTable)
      .where(eq(negativeSignalsTable.sessionId, sessionId)),
    reader
      .select()
      .from(cartItemsTable)
      .where(eq(cartItemsTable.sessionId, sessionId)),
  ]);

  // Oldest first, so the shaping panel reads in the order the parent acted.
  const byCreatedAt = <T extends { createdAt: Date }>(a: T, b: T) =>
    a.createdAt.getTime() - b.createdAt.getTime();

  return {
    pickIds: [] as string[],
    negativeIds: negatives.sort(byCreatedAt).map((row) => row.bookId),
    cartRows: cart.sort(byCreatedAt),
  };
}

export type LoadedSignalIds = Awaited<ReturnType<typeof loadSignalIds>>;

function thumbsFor(ids: string[]): BookThumbDto[] {
  return ids
    .map((id) => catalog.byId.get(id))
    .filter((product) => Boolean(product))
    .map((product) => toBookThumb(product!));
}

export function buildShaping(
  session: Session,
  pickIds: string[],
  negativeIds: string[],
): ShapingStateDto {
  const picks = thumbsFor(pickIds);
  const negatives = thumbsFor(negativeIds);
  const pivotProduct = session.pivotBookId
    ? catalog.byId.get(session.pivotBookId)
    : undefined;
  const pivot = pivotProduct ? toBookThumb(pivotProduct) : null;

  const parts: string[] = [];
  if (session.query) parts.push(session.query);
  if (picks.length > 0) {
    parts.push(`${picks.length} Filter`);
  }
  if (pivot) parts.push(`More like ${shortTitle(pivot.title)}`);
  if (negatives.length > 0) {
    parts.push(
      `${negatives.length} fewer like ${negatives.length === 1 ? "this" : "these"}`,
    );
  }

  const signalCount =
    (session.query ? 1 : 0) + picks.length + (pivot ? 1 : 0) + negatives.length;

  return {
    modeLabel: MODE.displayLabel,
    query: session.query,
    pivot,
    picks,
    negatives,
    hasSignals: signalCount > 0,
    signalCount,
    summaryText: parts.length > 0 ? parts.join(" \u00b7 ") : MODE.displayLabel,
  };
}

export async function buildSessionState(
  session: Session,
  loadedSignals?: LoadedSignalIds,
): Promise<SessionStateDto> {
  const { pickIds, negativeIds, cartRows } =
    loadedSignals ?? await loadSignalIds(session.id);

  return {
    sessionId: session.id,
    modeId: session.modeId,
    modeLabel: MODE.displayLabel,
    gradeLabel: MODE.gradeLabel,
    query: session.query,
    pickCount: pickIds.length,
    cartCount: cartRows.reduce((total, row) => total + row.quantity, 0),
    negativeCount: negativeIds.length,
    pickIds,
    cartIds: cartRows.map((row) => row.bookId),
    negativeIds,
    pivotId: session.pivotBookId,
    shaping: buildShaping(session, pickIds, negativeIds),
    rankingVersion: session.rankingVersion,
  };
}

/** Returns discovery to the mode-only starting state. Cart is purchase intent, so it survives. */
export async function resetDiscovery(sessionId: string): Promise<Session> {
  await Promise.all([
    db.delete(picksTable).where(eq(picksTable.sessionId, sessionId)),
    db
      .delete(negativeSignalsTable)
      .where(eq(negativeSignalsTable.sessionId, sessionId)),
  ]);

  const [session] = await db
    .update(sessionsTable)
    .set({
      query: null,
      queryPromptId: null,
      querySource: null,
      queryInterpretation: null,
      pivotBookId: null,
      rankingVersion: 0,
      updatedAt: new Date(),
    })
    .where(eq(sessionsTable.id, sessionId))
    .returning();

  return session;
}

export const sessionTables = {
  picksTable,
  negativeSignalsTable,
  cartItemsTable,
  and,
  eq,
};
