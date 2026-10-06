import assert from "node:assert/strict";
import test from "node:test";

import {
  generateSubjectSummary,
  isSubjectEnrichmentConfigured,
  type SubjectEnrichmentErrorCategory,
} from "../src/domain/subject-enrichment";
import type { SubjectSource } from "../src/domain/subject-summary";

const product: SubjectSource = {
  title: "River Mystery",
  description: "Two siblings investigate why wildlife is disappearing.",
  subjects: ["Mysteries > Family mysteries", "Nature > Rivers"],
  tags: ["Mystery"],
  formatLabel: "Paperback",
  readingLevel: "Grade 4",
  seriesName: null,
};

function reply(content: unknown, ok = true): Response {
  return {
    ok,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  } as Response;
}

test("configuration can be checked without making a request", () => {
  assert.equal(isSubjectEnrichmentConfigured({ apiKey: "test-key" }), true);
  assert.equal(isSubjectEnrichmentConfigured({ apiKey: "" }), false);
});

test("successful generation makes one structured, guarded request", async () => {
  let calls = 0;
  let requestBody: Record<string, unknown> | undefined;
  const result = await generateSubjectSummary(product, {
    config: { apiKey: "test-key", baseUrl: "https://example.test/v1" },
    fetch: async (_input, init) => {
      calls += 1;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return reply(
        '{"summary":"Two siblings investigate a wildlife mystery centered on a river."}',
      );
    },
    onCall: () => {
      calls += 10;
    },
  });

  assert.deepEqual(result, {
    summary: "Two siblings investigate a wildlife mystery centered on a river.",
  });
  assert.equal(calls, 11);
  assert.equal(requestBody?.["model"], "google/gemini-3.6-flash");
  assert.equal(
    (requestBody?.["response_format"] as { type: string }).type,
    "json_schema",
  );
  const messages = requestBody?.["messages"] as Array<{ content: string }>;
  assert.match(messages[0].content, /untrusted data/i);
  assert.equal(JSON.parse(messages[1].content).price, undefined);
});

test("all failure outcomes return null and bounded categories", async () => {
  const cases: Array<{
    expected: SubjectEnrichmentErrorCategory;
    fetch?: typeof globalThis.fetch;
    config?: { apiKey: string };
  }> = [
    { expected: "not_configured", config: { apiKey: "" } },
    {
      expected: "provider_error",
      fetch: async () => reply("", false),
      config: { apiKey: "key" },
    },
    {
      expected: "malformed_response",
      fetch: async () => reply("not json"),
      config: { apiKey: "key" },
    },
    {
      expected: "malformed_response",
      fetch: async () => reply('{"summary":"Fine.","extra":true}'),
      config: { apiKey: "key" },
    },
    {
      expected: "empty_summary",
      fetch: async () => reply('{"summary":""}'),
      config: { apiKey: "key" },
    },
    {
      expected: "invalid_summary",
      fetch: async () => reply('{"summary":"Perfect for every child."}'),
      config: { apiKey: "key" },
    },
    {
      expected: "invalid_summary",
      fetch: async () =>
        reply(
          '{"summary":"This book is perfect, ideal, recommended, and safe."}',
        ),
      config: { apiKey: "key" },
    },
    {
      expected: "invalid_summary",
      fetch: async () =>
        reply(
          '{"summary":"This award winner is a promotional reader favorite."}',
        ),
      config: { apiKey: "key" },
    },
    {
      expected: "invalid_summary",
      fetch: async () =>
        reply(
          '{"summary":"Published by Acme, this book explores friendship."}',
        ),
      config: { apiKey: "key" },
    },
  ];

  for (const item of cases) {
    const errors: SubjectEnrichmentErrorCategory[] = [];
    const result = await generateSubjectSummary(product, {
      config: item.config,
      fetch: item.fetch,
      onError: (category) => errors.push(category),
    });
    assert.equal(result, null);
    assert.deepEqual(errors, [item.expected]);
  }
});

test("timeout aborts the sole request and never throws", async () => {
  let calls = 0;
  const errors: SubjectEnrichmentErrorCategory[] = [];
  const result = await generateSubjectSummary(product, {
    config: { apiKey: "key" },
    timeoutMs: 1,
    fetch: async (_input, init) => {
      calls += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
    onError: (category) => errors.push(category),
  });
  assert.equal(result, null);
  assert.equal(calls, 1);
  assert.deepEqual(errors, ["timeout"]);
});