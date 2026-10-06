/**
 * Cart and simulated checkout.
 *
 * The cart is purchase intent and is kept entirely separate from Johnny's
 * Picks. Checkout is a demo confirmation: no payment is collected, no order is
 * placed, and the response says so explicitly.
 */
import { Router, type IRouter, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, cartItemsTable } from "@workspace/db";
import { catalog } from "../domain/catalog";
import { discountedPrice, toBookSummary } from "../domain/serializers";
import { findSession } from "../services/sessions";

const router: IRouter = Router();

async function requireSessionId(
  sessionId: string,
  res: Response,
): Promise<string | null> {
  const session = await findSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  return session.id;
}

async function buildCart(sessionId: string) {
  const rows = await db
    .select()
    .from(cartItemsTable)
    .where(eq(cartItemsTable.sessionId, sessionId));

  const items = rows
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((row) => {
      const product = catalog.byId.get(row.bookId);
      if (!product) return null;
      const unitPrice = discountedPrice(product.price) ?? 0;
      return {
        book: toBookSummary(product),
        quantity: row.quantity,
        lineTotal: Number((unitPrice * row.quantity).toFixed(2)),
      };
    })
    .filter((line) => line !== null);

  return {
    items,
    itemCount: items.reduce((total, line) => total + line.quantity, 0),
    subtotal: Number(
      items.reduce((total, line) => total + line.lineTotal, 0).toFixed(2),
    ),
    currency: "USD",
  };
}

router.get("/session/:sessionId/cart", async (req, res) => {
  const sessionId = await requireSessionId(req.params.sessionId, res);
  if (!sessionId) return;
  res.json(await buildCart(sessionId));
});

router.post("/session/:sessionId/cart", async (req, res) => {
  const sessionId = await requireSessionId(req.params.sessionId, res);
  if (!sessionId) return;

  const bookId = String(req.body?.bookId ?? "");
  if (!catalog.byId.has(bookId)) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const quantity = Math.max(1, Number(req.body?.quantity ?? 1) || 1);
  const [existing] = await db
    .select()
    .from(cartItemsTable)
    .where(
      and(
        eq(cartItemsTable.sessionId, sessionId),
        eq(cartItemsTable.bookId, bookId),
      ),
    );

  if (existing) {
    await db
      .update(cartItemsTable)
      .set({ quantity: existing.quantity + quantity })
      .where(
        and(
          eq(cartItemsTable.sessionId, sessionId),
          eq(cartItemsTable.bookId, bookId),
        ),
      );
  } else {
    await db.insert(cartItemsTable).values({ sessionId, bookId, quantity });
  }

  res.json(await buildCart(sessionId));
});

router.patch("/session/:sessionId/cart/:bookId", async (req, res) => {
  const sessionId = await requireSessionId(req.params.sessionId, res);
  if (!sessionId) return;

  const quantity = Math.max(0, Number(req.body?.quantity ?? 0) || 0);
  const where = and(
    eq(cartItemsTable.sessionId, sessionId),
    eq(cartItemsTable.bookId, req.params.bookId),
  );

  // Quantity zero is how the stepper removes a line.
  if (quantity === 0) {
    await db.delete(cartItemsTable).where(where);
  } else {
    await db.update(cartItemsTable).set({ quantity }).where(where);
  }

  res.json(await buildCart(sessionId));
});

router.delete("/session/:sessionId/cart/:bookId", async (req, res) => {
  const sessionId = await requireSessionId(req.params.sessionId, res);
  if (!sessionId) return;

  await db
    .delete(cartItemsTable)
    .where(
      and(
        eq(cartItemsTable.sessionId, sessionId),
        eq(cartItemsTable.bookId, req.params.bookId),
      ),
    );

  res.json(await buildCart(sessionId));
});

router.post("/session/:sessionId/checkout", async (req, res) => {
  const sessionId = await requireSessionId(req.params.sessionId, res);
  if (!sessionId) return;

  const cart = await buildCart(sessionId);

  if (cart.itemCount === 0) {
    res.status(400).json({ error: "Cart is empty" });
    return;
  }

  const reference = `HDS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  // The cart is emptied so the prototype returns to a coherent state; the
  // totals travel with the confirmation instead.
  await db.delete(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));

  res.json({
    reference,
    itemCount: cart.itemCount,
    subtotal: cart.subtotal,
    currency: cart.currency,
    demo: true,
    message:
      "This is a prototype. No payment was taken and no order was placed.",
  });
});

export default router;
