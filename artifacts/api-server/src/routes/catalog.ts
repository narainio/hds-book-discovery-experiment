/** Catalog-facing reads: modes, curated prompts, typeahead and product detail. */
import { Router, type IRouter } from "express";
import { catalog } from "../domain/catalog";
import { MODE, MODES, CURATED_PROMPTS } from "../domain/config";
import { toBookDetail } from "../domain/serializers";
import { readSubjectSummary } from "../domain/subject-detail";
import { GetBookResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/modes", (_req, res) => {
  res.json(
    MODES.map((mode) => ({
      id: mode.id,
      label: mode.label,
      available: mode.available,
      note: mode.note,
    })),
  );
});

router.get("/prompts", (_req, res) => {
  res.json(
    CURATED_PROMPTS.map((prompt) => ({
      id: prompt.id,
      label: prompt.label,
      query: prompt.query,
    })),
  );
});

router.get("/catalog/stats", (_req, res) => {
  res.json({
    totalBooks: catalog.size,
    modeLabel: MODE.displayLabel,
    gradeLabel: MODE.gradeLabel,
  });
});

router.get("/typeahead", (req, res) => {
  const query = String(req.query["q"] ?? "").trim();

  if (query.length < 2) {
    res.json({ query, groups: [], totalCount: 0 });
    return;
  }

  const needle = query.toLowerCase();
  const groups: {
    label: string;
    kind: string;
    items: {
      id: string;
      text: string;
      kind: string;
      secondaryLabel: string | null;
      bookId: string | null;
      query: string | null;
    }[];
  }[] = [];

  const titleMatches = catalog.products
    .filter((product) => product.titleLower.includes(needle))
    // Prefer matches at the start of the title - they read as more relevant.
    .sort((a, b) => a.titleLower.indexOf(needle) - b.titleLower.indexOf(needle))
    .slice(0, 5);

  if (titleMatches.length > 0) {
    groups.push({
      label: "Books",
      kind: "book",
      items: titleMatches.map((product) => ({
        id: `book:${product.id}`,
        text: product.title,
        kind: "book",
        secondaryLabel: product.author || null,
        bookId: product.id,
        query: null,
      })),
    });
  }

  const seriesMatches = [...catalog.seriesIndex.entries()]
    .filter(([key]) => key.includes(needle))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3);

  if (seriesMatches.length > 0) {
    groups.push({
      label: "Series",
      kind: "series",
      items: seriesMatches.map(([key, entry]) => ({
        id: `series:${key}`,
        text: entry.name,
        kind: "series",
        secondaryLabel: `${entry.count} book${entry.count === 1 ? "" : "s"}`,
        bookId: null,
        query: entry.name,
      })),
    });
  }

  const authorMatches = [...catalog.authorIndex.entries()]
    .filter(([key]) => key.includes(needle))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3);

  if (authorMatches.length > 0) {
    groups.push({
      label: "Authors",
      kind: "author",
      items: authorMatches.map(([key, entry]) => ({
        id: `author:${key}`,
        text: entry.name,
        kind: "author",
        secondaryLabel: `${entry.count} book${entry.count === 1 ? "" : "s"}`,
        bookId: null,
        query: entry.name,
      })),
    });
  }

  const subjectMatches = [...catalog.subjectIndex.entries()]
    .filter(([key]) => key.includes(needle))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3);

  if (subjectMatches.length > 0) {
    groups.push({
      label: "Subjects",
      kind: "subject",
      items: subjectMatches.map(([key, entry]) => ({
        id: `subject:${key}`,
        text: entry.name,
        kind: "subject",
        secondaryLabel: `${entry.count} book${entry.count === 1 ? "" : "s"}`,
        bookId: null,
        query: entry.name,
      })),
    });
  }

  res.json({
    query,
    groups,
    totalCount: groups.reduce((total, group) => total + group.items.length, 0),
  });
});

router.get("/books/:bookId", async (req, res): Promise<void> => {
  const product = catalog.byId.get(req.params.bookId);

  if (!product) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const summary = await readSubjectSummary(product);
  res.json(GetBookResponse.parse(toBookDetail(product, summary)));
});

export default router;
