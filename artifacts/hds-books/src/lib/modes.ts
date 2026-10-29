/**
 * Saved Modes: a small, versioned, validated browser-local repository for one
 * simulated logged-in demo user. A Mode is a reusable Filter recipe, not a
 * live reference to session state. This is the only module that reads or
 * writes Mode storage.
 *
 * Not an authentication or security mechanism: data lives in this browser
 * only, is not synced across devices, and different browsers are isolated.
 */

export const MODES_STORAGE_KEY = 'hds_pf_demo_user_modes';
export const MODES_SCHEMA_VERSION = 1;

export interface ModeContext {
  /** The engine's existing shopping mode id (e.g. "johnny"). */
  modeId: string;
  label: string;
}

export interface ModeDefinition {
  id: string;
  schemaVersion: 1;
  name: string;
  /** Explicit base intention text, or null. */
  baseIntention: string | null;
  /** Explicit additive textual refinements, in order. */
  refinements: string[];
  /** Reusable mode context where applicable. */
  context: ModeContext | null;
  /** Deliberately selected products (the Filter's example book), 0–1 entries. */
  selectedProductIds: string[];
  createdAt: string;
}

export type NewModeInput = Pick<ModeDefinition, 'name' | 'baseIntention' | 'refinements' | 'context' | 'selectedProductIds'>;

interface Envelope {
  version: 1;
  /** Set once the demo Mode has been seeded; never re-seeded afterwards. */
  seeded: boolean;
  modes: ModeDefinition[];
}

export interface ModesState {
  modes: ModeDefinition[];
  /** Non-blocking notice about recovered or unavailable storage. */
  notice: string | null;
  /** False when storage cannot be written (unavailable or newer version). */
  writable: boolean;
}

export type SaveResult = { ok: true; mode: ModeDefinition } | { ok: false; message: string };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const MAX_MODES = 100;

function isString(v: unknown): v is string { return typeof v === 'string'; }

export function validateMode(value: unknown): ModeDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.schemaVersion !== 1) return null;
  if (!isString(r.id) || !r.id) return null;
  if (!isString(r.name) || !r.name.trim() || r.name.length > 200) return null;
  if (!(r.baseIntention === null || isString(r.baseIntention))) return null;
  if (!Array.isArray(r.refinements) || !r.refinements.every(isString) || r.refinements.length > 50) return null;
  if (!Array.isArray(r.selectedProductIds) || !r.selectedProductIds.every(isString) || r.selectedProductIds.length > 1) return null;
  if (!isString(r.createdAt) || Number.isNaN(Date.parse(r.createdAt))) return null;
  let context: ModeContext | null = null;
  if (r.context !== null) {
    const c = r.context as Record<string, unknown> | undefined;
    if (!c || typeof c !== 'object' || !isString(c.modeId) || !isString(c.label)) return null;
    context = { modeId: c.modeId, label: c.label };
  }
  return {
    id: r.id,
    schemaVersion: 1,
    name: r.name,
    baseIntention: r.baseIntention as string | null,
    refinements: [...(r.refinements as string[])],
    context,
    selectedProductIds: [...(r.selectedProductIds as string[])],
    createdAt: r.createdAt,
  };
}

/** Deep copy so callers never share mutable references with the repository. */
export function copyMode(mode: ModeDefinition): ModeDefinition {
  return {
    ...mode,
    refinements: [...mode.refinements],
    selectedProductIds: [...mode.selectedProductIds],
    context: mode.context ? { ...mode.context } : null,
  };
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `mode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ModeRepository {
  private envelope: Envelope = { version: 1, seeded: false, modes: [] };
  private notice: string | null = null;
  private writable = true;
  private snapshot: ModesState = { modes: [], notice: null, writable: true };
  private listeners = new Set<() => void>();

  constructor(
    private storage: StorageLike | null,
    private now: () => Date = () => new Date(),
    private newId: () => string = defaultId,
  ) {
    this.read();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  private publish() {
    this.snapshot = { modes: this.envelope.modes.map(copyMode), notice: this.notice, writable: this.writable };
    this.listeners.forEach((l) => l());
  }

  /** Read and validate storage. Never throws; never overwrites unreadable data. */
  private read() {
    if (!this.storage) {
      this.writable = false;
      this.notice = 'Saved Modes aren’t available in this browser.';
      this.publish();
      return;
    }
    let raw: string | null;
    try {
      raw = this.storage.getItem(MODES_STORAGE_KEY);
    } catch {
      this.writable = false;
      this.notice = 'Saved Modes couldn’t be read in this browser.';
      this.publish();
      return;
    }
    if (raw === null) {
      this.publish();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.setAside(raw);
      return;
    }
    const record = parsed as Record<string, unknown> | null;
    if (!record || typeof record !== 'object' || typeof record.version !== 'number' || !Array.isArray(record.modes)) {
      this.setAside(raw);
      return;
    }
    if (record.version > MODES_SCHEMA_VERSION) {
      // Written by a newer build: show nothing, and never overwrite it.
      this.writable = false;
      this.notice = 'Saved Modes were created by a newer version and can’t be used here.';
      this.publish();
      return;
    }
    const modes = (record.modes as unknown[]).map(validateMode);
    const valid = modes.filter((m): m is ModeDefinition => m !== null).slice(0, MAX_MODES);
    this.envelope = { version: 1, seeded: record.seeded === true || valid.length > 0, modes: valid };
    if (valid.length < modes.length) {
      this.notice = 'Some saved Modes couldn’t be read and were left out.';
    }
    this.publish();
  }

  /** Keep unreadable data under a backup key, then continue with an empty list. */
  private setAside(raw: string) {
    try {
      this.storage?.setItem(`${MODES_STORAGE_KEY}.unreadable`, raw);
      this.storage?.setItem(MODES_STORAGE_KEY, JSON.stringify({ version: 1, seeded: true, modes: [] }));
    } catch {
      this.writable = false;
    }
    // Seeded is treated as done: recovery must not re-insert the demo Mode.
    this.envelope = { version: 1, seeded: true, modes: [] };
    this.notice = 'Saved Modes couldn’t be read and were set aside.';
    this.publish();
  }

  private write(next: Envelope): boolean {
    if (!this.storage || !this.writable) return false;
    try {
      this.storage.setItem(MODES_STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  }

  /** Seed the documented demo Mode exactly once per browser profile. */
  ensureSeeded(seed: NewModeInput) {
    if (this.envelope.seeded || !this.writable) return;
    const mode = this.build(seed);
    const next: Envelope = { version: 1, seeded: true, modes: [mode, ...this.envelope.modes] };
    if (this.write(next)) {
      this.envelope = next;
      this.publish();
    }
  }

  private build(input: NewModeInput): ModeDefinition {
    return {
      id: this.newId(),
      schemaVersion: 1,
      name: input.name.trim(),
      baseIntention: input.baseIntention,
      refinements: [...input.refinements],
      context: input.context ? { ...input.context } : null,
      selectedProductIds: [...input.selectedProductIds].slice(0, 1),
      createdAt: this.now().toISOString(),
    };
  }

  /** Always creates a new record with a stable new id; identical names are allowed. */
  save(input: NewModeInput): SaveResult {
    if (!this.writable) return { ok: false, message: 'Your Mode couldn’t be saved in this browser. Your Filter is unchanged.' };
    if (this.envelope.modes.length >= MAX_MODES) {
      return { ok: false, message: `You can keep up to ${MAX_MODES} Modes in this demo.` };
    }
    const mode = this.build(input);
    const next: Envelope = { ...this.envelope, modes: [...this.envelope.modes, mode] };
    if (!this.write(next)) {
      return { ok: false, message: 'Your Mode couldn’t be saved in this browser. Your Filter is unchanged.' };
    }
    this.envelope = next;
    this.publish();
    return { ok: true, mode: copyMode(mode) };
  }

  get(id: string): ModeDefinition | null {
    const mode = this.envelope.modes.find((m) => m.id === id);
    return mode ? copyMode(mode) : null;
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

let shared: ModeRepository | null = null;

export function getModeRepository(): ModeRepository {
  shared ??= new ModeRepository(browserStorage());
  return shared;
}

/**
 * Short factual summary of what a Mode will reapply, e.g. "Age 10 · Books".
 * The recipient age is stored context only (never an eligibility rule), and
 * the context label is not repeated when it only restates the Mode's name.
 */
export function modeSummary(mode: ModeDefinition): string {
  const parts: string[] = [];
  const age = mode.context?.label.match(/\bage\s+(\d+)/i)?.[1];
  if (age) parts.push(`Age ${age}`);
  const words = [mode.baseIntention, ...mode.refinements].filter((w): w is string => !!w).map((w) => `“${w}”`);
  parts.push(words.length > 0 ? words.join(' + ') : 'Books');
  if (mode.selectedProductIds.length > 0) parts.push('1 book in Filter');
  return parts.join(' · ');
}
