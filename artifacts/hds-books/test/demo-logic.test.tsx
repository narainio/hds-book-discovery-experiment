import assert from "node:assert/strict";
import { test } from "node:test";
import { shortFilterLabel } from "../src/lib/intention.ts";
import { deliveryCountdown, formatCountdown, greetingFor } from "../src/lib/demo-time.ts";
import { resetDemoStorage } from "../src/lib/demo-reset.ts";
import { pickNewReleases } from "../src/lib/new-releases.ts";

test("shortFilterLabel: brief examples, empty and length limit", () => {
  assert.equal(shortFilterLabel("Books to be read by older sister"), "Read by older sister");
  assert.equal(shortFilterLabel("funny graphic novels."), "Funny graphic novels");
  assert.equal(shortFilterLabel("Something with dragons and a brave girl who saves her village"), "With dragons and a brave…");
  assert.equal(shortFilterLabel("funny mysteries"), "Funny mysteries");
  // Only one filler phrase, whole words only.
  assert.equal(shortFilterLabel("I want looking for owls"), "Looking for owls");
  assert.equal(shortFilterLabel("Booksellers about town"), "Booksellers about town");
  // Filler only: falls back to the normalized original.
  assert.equal(shortFilterLabel("  something!! "), "something");
  assert.equal(shortFilterLabel(""), "");
  const long = shortFilterLabel("supercalifragilisticexpialidociousness everywhere");
  assert.ok(long.endsWith("…") && long.length <= 29, long);
  assert.ok(shortFilterLabel("x ".repeat(40)).length <= 29);
});

test("greeting by local time windows", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m);
  assert.equal(greetingFor(at(0)), "Good morning");
  assert.equal(greetingFor(at(11, 59)), "Good morning");
  assert.equal(greetingFor(at(12)), "Good afternoon");
  assert.equal(greetingFor(at(17, 59)), "Good afternoon");
  assert.equal(greetingFor(at(18)), "Good evening");
  assert.equal(greetingFor(at(23, 59)), "Good evening");
});

test("delivery countdown: before and after Tuesday cutoff, format boundaries", () => {
  // 2026-10-26 is a Monday; Tuesday 2026-10-27 14:00 is the cutoff.
  const mon = new Date(2026, 9, 26, 8, 0);
  const a = deliveryCountdown(mon);
  assert.equal(a.cutoff.getDay(), 2);
  assert.equal(a.cutoff.getDate(), 27);
  assert.equal(a.label, "1 day, 6 hrs");
  assert.equal(deliveryCountdown(new Date(2026, 9, 27, 9, 0)).label, "5 hrs");
  assert.equal(deliveryCountdown(new Date(2026, 9, 27, 13, 15)).label, "45 min");
  // At or after the cutoff rolls over to next Tuesday.
  const after = deliveryCountdown(new Date(2026, 9, 27, 14, 0));
  assert.equal(after.cutoff.getDate(), 3);
  assert.equal(after.cutoff.getMonth(), 10);
  assert.equal(after.label, "7 days");
  const m = 60_000, h = 60 * m;
  assert.equal(formatCountdown(59 * m + 59_000), "59 min");
  assert.equal(formatCountdown(h), "1 hr");
  assert.equal(formatCountdown(24 * h), "24 hrs");
  assert.equal(formatCountdown(24 * h + m), "1 day");
  assert.equal(formatCountdown(25 * h), "1 day, 1 hr");
});

class Mem {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

test("resetDemoStorage clears hds_pf_ keys in both storages and keeps others", () => {
  const local = new Mem(); const session = new Mem();
  for (const k of ["hds_pf_experiment_session_id", "hds_pf_demo_user_modes", "hds_pf_demo_user_modes.unreadable", "hds_pf_working_context", "other_app_key"]) local.setItem(k, "1");
  session.setItem("hds_pf_home_draft", "x"); session.setItem("other_app_key", "y");
  assert.equal(resetDemoStorage(local, session), 5);
  assert.deepEqual([...local.map.keys()], ["other_app_key"]);
  assert.deepEqual([...session.map.keys()], ["other_app_key"]);
});

test("resetDemoStorage does not throw when storage is unavailable", () => {
  const broken = { get length(): number { throw new Error("denied"); }, key: () => null, removeItem: () => {} };
  assert.doesNotThrow(() => resetDemoStorage(null, undefined));
  assert.doesNotThrow(() => resetDemoStorage(broken, broken));
});

test("new releases: first 24 only, 2025/2026, max 8, min 3, order untouched", () => {
  const mk = (i: number, y: number | null | undefined) => ({ book: { id: `b${i}`, publicationYear: y }, score: 100 - i });
  const results = Array.from({ length: 30 }, (_, i) => mk(i, i % 2 === 0 ? 2025 + (i % 4 === 0 ? 1 : 0) : 2023));
  results[3] = mk(3, null); results[5] = mk(5, undefined);
  const before = results.map((r) => r.book.id);
  const picked = pickNewReleases(results);
  assert.equal(picked.length, 8);
  assert.deepEqual(picked.map((r) => r.book.id), ["b0", "b2", "b4", "b6", "b8", "b10", "b12", "b14"]);
  assert.deepEqual(results.map((r) => r.book.id), before);
  // Books beyond the first 24 never qualify; fewer than three hides the section.
  const late = Array.from({ length: 30 }, (_, i) => mk(i, i >= 24 ? 2026 : 2024));
  assert.deepEqual(pickNewReleases(late), []);
  assert.deepEqual(pickNewReleases([mk(0, 2026), mk(1, 2025)]), []);
  assert.equal(pickNewReleases([mk(0, 2026), mk(1, 2025), mk(2, 2026)]).length, 3);
});
