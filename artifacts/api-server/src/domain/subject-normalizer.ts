export const SUBJECT_NORMALIZER_VERSION = "1";

export type TopicNormalizationInput = {
  subjects: string[];
  tags: string[];
};

const MAX_TOPICS = 6;
const NORMAL_TOPIC_LIMIT = 5;

/**
 * Supplier terms that benefit from clearer customer-facing wording. Keys are
 * compared case-insensitively after feed punctuation and whitespace cleanup.
 */
const TOPIC_LABELS: Readonly<Record<string, string>> = {
  "coding & programming": "Coding and technology",
  "computers & digital media": "Computers and digital media",
  "mysteries & detective stories": "Mysteries",
  "mystery and detective stories": "Mysteries",
  "mystery & detective": "Mysteries",
  "funny stories": "Humor",
  "humorous stories": "Humor",
  "city & town life": "City life",
  "mice & rats": "Mice and rats",
  "alligators & crocodiles": "Alligators and crocodiles",
  "amphibians & reptiles": "Amphibians and reptiles",
  "coming of age": "Growing up",
  "biographies & memoirs": "Biography and memoir",
  memoirs: "Memoir",
  "action & adventure": "Action and adventure",
  "science fiction": "Science fiction",
  "fantasy & magic": "Fantasy and magic",
  "fairy tales": "Fairy tales",
  "folklore & mythology": "Folklore and mythology",
  "ghosts & spirits": "Ghosts and spirits",
  "thrillers & suspense": "Thrillers and suspense",
  "emotions & feelings": "Emotions and feelings",
  "self-esteem": "Self-esteem",
  "death & dying": "Death and dying",
  "discrimination & prejudice": "Discrimination and prejudice",
  "emigration & immigration": "Emigration and immigration",
  "civil & human rights": "Civil and human rights",
  "habitats & ecosystems": "Habitats and ecosystems",
  "flowers & plants": "Flowers and plants",
  "baseball & softball": "Baseball and softball",
  "cars & trucks": "Cars and trucks",
  "rocks & minerals": "Rocks and minerals",
  "planets & stars": "Planets and stars",
  "dragons, unicorns & mythical creatures": "Dragons, unicorns and mythical creatures",
  "parents": "Parents",
  "dads": "Dads",
  "moms": "Moms",
};

/**
 * Structural labels are omitted when a useful descendant exists. They remain
 * available as grounded fallbacks when a path contains nothing more specific.
 */
const BROAD_LABELS = new Set([
  "all",
  "general",
  "other",
  "juvenile fiction",
  "juvenile nonfiction",
  "people, places & society",
  "society",
  "family, friends & school",
  "my family & me",
  "being me",
  "family members",
  "action, adventure & mystery",
  "mysteries & thrillers",
  "humor, poetry & verse",
  "humor",
  "animals",
  "stem",
  "math & technology",
  "engineering & technology",
  "biographies & history",
  "fantasy & science fiction",
  "sports, gaming & recreation",
  "sports",
  "people & places",
  "places",
]);

const NEVER_DISPLAY = new Set([
  "-",
  "all",
  "general",
  "other",
  "vertical placement completed",
  "school books",
  "hospital collection",
  "includes back matter",
  "educator guide available",
  "high text complexity",
]);

/**
 * This allowlist is deliberately closed: arbitrary supplier workflow, series,
 * ranking, availability, and untranslated tags must never become topics.
 */
const APPROVED_TAG_LABELS: Readonly<Record<string, string>> = {
  "graphic novel": "Graphic novel",
  memoir: "Memoir",
  humor: "Humor",
  "humorous stories": "Humor",
  "includes illustrations": "Includes illustrations",
  "novel in verse": "Novel in verse",
  anthology: "Anthology",
  "creative nonfiction": "Creative nonfiction",
  friendship: "Friendship",
  "historical fiction": "Historical fiction",
  "science fiction": "Science fiction",
  mystery: "Mysteries",
  "mystery & detective": "Mysteries",
  "mystery and detective stories": "Mysteries",
  "fairy tales & folklore": "Fairy tales and folklore",
};

const PROPER_NAMES = [
  "New York",
  "Chicago",
  "California",
  "United States",
  "North America",
  "South America",
  "American Revolution",
  "World War II",
  "World War I",
  "Ancient Egypt",
  "Ancient Greece",
  "Taylor Swift",
  "African American",
  "Asian American",
  "Native American",
  "Europe",
  "European",
  "American",
  "African",
  "Asian",
  "Australian",
  "Asia",
  "Africa",
  "Canada",
  "Mexico",
] as const;

/**
 * Relationships that are semantically redundant even if supplier paths arrive
 * separately or omit a shared segment. Path ancestry is checked as well.
 */
const TOPICS_SUPPRESSED_BY: Readonly<Record<string, readonly string[]>> = {
  "coding and technology": ["computers and digital media"],
  mysteries: ["action, adventure & mystery"],
  parents: ["my family & me"],
  dads: ["parents", "my family & me"],
  moms: ["parents", "my family & me"],
  "alligators and crocodiles": ["amphibians and reptiles", "animals"],
};

function cleanSegment(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:|/\\.!?_-]+|[\s,;:|/\\.!?_-]+$/g, "")
    .replace(/([,;:!?])\1+/g, "$1")
    .trim();
}

function key(value: string): string {
  return cleanSegment(value).toLocaleLowerCase("en-US");
}

function sentenceCase(value: string): string {
  // Ampersands are retained by default: they can be meaningful in names and
  // recognized terms such as R&B. Familiar taxonomy wording that should use
  // "and" is handled explicitly in TOPIC_LABELS.
  const cleaned = cleanSegment(value);
  if (!cleaned) return "";

  let result = cleaned.toLocaleLowerCase("en-US");
  result = result.replace(/\bstem\b/g, "STEM");
  result = result.replace(/\bus\b/g, "US");
  result = result.replace(/\br&b\b/g, "R&B");
  result = result.replace(/\blgbtqia\+\b/gi, "LGBTQIA+");
  for (const properName of PROPER_NAMES) {
    result = result.replace(
      new RegExp(`\\b${properName.toLocaleLowerCase("en-US").replace(/\s+/g, "\\s+")}\\b`, "g"),
      properName,
    );
  }
  return result.charAt(0).toLocaleUpperCase("en-US") + result.slice(1);
}

function topicLabel(segment: string): string {
  return TOPIC_LABELS[key(segment)] ?? sentenceCase(segment);
}

function parsePath(path: string): string[] {
  return path
    .split(">")
    .map(cleanSegment)
    .filter((segment) => segment.length > 0 && !NEVER_DISPLAY.has(key(segment)));
}

export function getApprovedSubjectTags(tags: string[]): string[] {
  const approved: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const label = APPROVED_TAG_LABELS[key(tag)];
    const identity = label?.toLocaleLowerCase("en-US");
    if (!label || seen.has(identity)) continue;
    seen.add(identity);
    approved.push(label);
  }

  return approved;
}

type Candidate = {
  label: string;
  branch: string;
  broad: boolean;
  sourceKey: string;
  ancestorKeys: readonly string[];
};

function subjectCandidate(path: string): Candidate | null {
  const segments = parsePath(path);
  if (segments.length === 0) return null;

  const specific = [...segments].reverse().find((segment) => !BROAD_LABELS.has(key(segment)));
  const selected = specific ?? segments.at(-1);
  if (!selected) return null;

  return {
    label: topicLabel(selected),
    branch: key(segments[0]),
    broad: !specific,
    sourceKey: key(selected),
    ancestorKeys: segments.slice(0, -1).map(key),
  };
}

function isSuppressedByMoreSpecific(
  candidate: Candidate,
  candidates: readonly Candidate[],
): boolean {
  const candidateLabel = candidate.label.toLocaleLowerCase("en-US");
  return candidates.some((other) => {
    if (other === candidate) return false;
    if (other.ancestorKeys.includes(candidate.sourceKey)) return true;
    return (TOPICS_SUPPRESSED_BY[other.label.toLocaleLowerCase("en-US")] ?? [])
      .includes(candidateLabel);
  });
}

/**
 * Builds stable, grounded PDP topics without consulting descriptions or any
 * generated content. Source order is retained while the first selection pass
 * favors distinct top-level taxonomy branches.
 */
export function buildDisplayTopics({
  subjects,
  tags,
}: TopicNormalizationInput): string[] {
  const candidates: Candidate[] = [];
  const seenLabels = new Set<string>();

  for (const path of subjects) {
    const candidate = subjectCandidate(path);
    const identity = candidate?.label.toLocaleLowerCase("en-US");
    if (!candidate || !identity || seenLabels.has(identity)) continue;
    seenLabels.add(identity);
    candidates.push(candidate);
  }

  const specificCandidates = candidates.filter((candidate) => !candidate.broad);
  // Broad labels are grounded fallbacks, not filler beside concrete concepts.
  // Specific descendants also suppress their ancestors when those arrive as a
  // separate source path.
  const usefulCandidates = (specificCandidates.length > 0 ? specificCandidates : candidates)
    .filter((candidate, _index, pool) => !isSuppressedByMoreSpecific(candidate, pool));

  const selected: Candidate[] = [];
  const selectedBranches = new Set<string>();
  for (const candidate of usefulCandidates) {
    if (selectedBranches.has(candidate.branch)) continue;
    selected.push(candidate);
    selectedBranches.add(candidate.branch);
  }

  const richBranchCount = selectedBranches.size;
  const limit = richBranchCount >= NORMAL_TOPIC_LIMIT ? MAX_TOPICS : NORMAL_TOPIC_LIMIT;
  for (const candidate of usefulCandidates) {
    if (selected.length >= limit) break;
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
  }

  // Approved editorial tags supplement sparse taxonomy. Graphic novel is
  // approved for generation context but intentionally stays in the facts area.
  for (const label of getApprovedSubjectTags(tags)) {
    if (selected.length >= limit) break;
    if (label === "Graphic novel") continue;
    const identity = label.toLocaleLowerCase("en-US");
    if (selected.some((candidate) => candidate.label.toLocaleLowerCase("en-US") === identity)) {
      continue;
    }
    selected.push({
      label,
      branch: `tag:${identity}`,
      broad: false,
      sourceKey: `tag:${identity}`,
      ancestorKeys: [],
    });
  }

  return selected.slice(0, MAX_TOPICS).map(({ label }) => label);
}