import assert from "node:assert/strict";
import { mock, test } from "node:test";

mock.module("@workspace/api-client-react", { namedExports: {} });
const { submitFilterText } = await import("../src/lib/filter-text.ts");

const ok = async (text: string) => ({ text, status: "supported", caveats: [] }) as never;

test("submitting a second string replaces the first; addRefinement is never called", async () => {
  const calls: string[] = [];
  const targets: string[] = [];
  const actions = {
    editIntention: (t: string | null) => calls.push(`edit:${t}`),
    addRefinement: (t: string) => calls.push(`add:${t}`),
  };
  const deps = { assess: ok, editIntention: actions.editIntention, setTarget: (t: string) => targets.push(t) };
  assert.deepEqual(await submitFilterText("Books to be read by older sister", deps), { kind: "applied", text: "Books to be read by older sister" });
  assert.deepEqual(await submitFilterText("  funny   mysteries ", deps), { kind: "applied", text: "funny mysteries" });
  // Full text (not the short label) goes to editIntention, each time replacing.
  assert.deepEqual(calls, ["edit:Books to be read by older sister", "edit:funny mysteries"]);
  assert.ok(!calls.some((c) => c.startsWith("add:")));
  assert.deepEqual(targets, ["Books to be read by older sister", "funny mysteries"]);
});

test("empty, stale and blocked submissions do not change the Filter", async () => {
  const calls: string[] = [];
  const deps = { assess: ok, editIntention: (t: string) => calls.push(t), setTarget: () => {} };
  assert.deepEqual(await submitFilterText("   ", deps), { kind: "empty" });
  assert.deepEqual(await submitFilterText("dragons", { ...deps, isCurrent: () => false }), { kind: "stale" });
  const blocked = await submitFilterText("pizza", { ...deps, assess: async () => ({ text: "pizza", status: "unsupported", unsupportedCategories: [{ label: "Pizza", plural: "pizza" }], caveats: [] }) as never });
  assert.equal(blocked.kind, "blocked");
  assert.deepEqual(calls, []);
});
