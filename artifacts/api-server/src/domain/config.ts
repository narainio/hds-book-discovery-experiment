/**
 * Every tunable in the discovery system lives here.
 *
 * The PRD requires that ranking weights, caps and explanation templates be
 * centralized so the demo can be tuned without hunting through modules, and so
 * that no customer-facing explanation text can be invented at the call site.
 */

export const MODE = {
  id: "johnny",
  label: "Book for Johnny",
  /** Shown in the Mode section of the shaping panel. */
  displayLabel: "Book for Johnny \u00b7 age 10",
  /**
   * Grounded in the feed's ReadingLevel field, which reads "4th - 5th Grade" on
   * every record. The written design spec says grades 5-6; the feed wins.
   */
  gradeLabel: "age 10 \u00b7 grades 4\u20135",
} as const;

export const MODES = [
  {
    id: "johnny",
    label: "Book for Johnny",
    available: true,
    note: null,
  },
  {
    id: "another-child",
    label: "Another child",
    available: false,
    note: "Available in a later release",
  },
  {
    id: "classroom",
    label: "Classroom",
    available: false,
    note: "Available in a later release",
  },
  {
    id: "gift",
    label: "Gift",
    available: false,
    note: "Available in a later release",
  },
] as const;

/**
 * Scoring weights for S(p) = wq*Q + wc*C + wb*B + wm*M + we*E - wn*N
 *
 * Q query relevance, C similarity to Picks, B catalog quality prior,
 * M similarity to the active pivot, E editorial affinity, N negative penalty.
 */
export const WEIGHTS = {
  query: 1.0,
  picks: 0.85,
  base: 0.18,
  pivot: 1.1,
  editorial: 0.35,
  negative: 1.3,
} as const;

export const RANKING = {
  /** Books already in Picks stay visible but step aside for fresh discoveries. */
  pickedBookDemotion: 0.45,
  /**
   * Spanish editions remain in the catalog and fully searchable, but a flat
   * demotion keeps them out of the default browse for this English-reading
   * mode. A strong query match still outranks the penalty.
   */
  spanishEditionDemotion: 0.6,
  /** Below this max query score we admit the query matched nothing meaningful. */
  weakQueryThreshold: 0.06,
  /** A reason weaker than this is omitted rather than shown. */
  minReasonStrength: 0.12,
  /** Diversity caps, applied over a sliding window of results. */
  diversityWindow: 12,
  maxPerSeriesInWindow: 2,
  maxPerSubjectInWindow: 4,
  defaultPageSize: 24,
  maxPageSize: 48,
  /** Similarity floor for a book to count as "similar to" a pick or pivot. */
  similarityFloor: 0.05,
} as const;

/**
 * Reason codes map to approved copy templates. Explanation text is only ever
 * produced by these functions - never generated, never free-form.
 */
export const REASON_TEMPLATES = {
  SIMILAR_TO_PICK: (bookTitle: string) => `Because you picked ${bookTitle}`,
  SIMILAR_TO_PIVOT: (bookTitle: string) => `More like ${bookTitle}`,
  SAME_SERIES_AS_PICK: (seriesName: string) => `More from ${seriesName}`,
  MATCHES_QUERY: (queryLabel: string) => `Matches ${queryLabel}`,
  SHARED_SUBJECTS: (subjectLabel: string) => `Similar ${subjectLabel} themes`,
  POPULAR_IN_MODE: () => "Frequently chosen for this age",
} as const;

export type ReasonCode = keyof typeof REASON_TEMPLATES;

/**
 * Curated prompts are hard-mapped to deterministic interpretations. They must
 * never depend on a language model being reachable.
 */
/**
 * The concepts a parent can ask for less of. `reduce` lists elsewhere hold
 * these KEYS, not raw words - the ranker expands them through
 * REDUCE_CONCEPT_TERMS, so a raw word like "gore" placed here would silently
 * match nothing.
 */
export type ReduceConcept = "scary" | "sad" | "romance";

export type CuratedPromptDefinition = {
  id: string;
  label: string;
  query: string;
  themes: string[];
  formats: string[];
  reduce: ReduceConcept[];
  terms: string[];
  seriesHint: string | null;
};

export const CURATED_PROMPTS: CuratedPromptDefinition[] = [
  {
    id: "funny-graphic-novels",
    label: "Funny graphic novels",
    query: "Funny graphic novels",
    themes: ["Humor, Poetry & Verse", "Humor"],
    formats: ["Graphic Novel"],
    reduce: [],
    terms: ["funny", "humor", "humorous", "comic", "graphic", "novel", "laugh"],
    seriesHint: null,
  },
  {
    id: "animal-adventures",
    label: "Animal adventures",
    query: "Animal adventures",
    themes: ["Animals", "Action, Adventure & Mystery"],
    formats: [],
    reduce: [],
    terms: ["animal", "animals", "adventure", "wild", "creature", "wilderness"],
    seriesHint: null,
  },
  {
    id: "mysteries-not-too-scary",
    label: "Mysteries that aren\u2019t too scary",
    query: "Mysteries that aren\u2019t too scary",
    themes: ["Action, Adventure & Mystery", "Mysteries & Detective Stories"],
    formats: [],
    reduce: ["scary"],
    terms: ["mystery", "mysteries", "detective", "clue", "puzzle", "sleuth"],
    seriesHint: null,
  },
  {
    id: "reluctant-reader",
    label: "Books for a reluctant reader",
    query: "Books for a reluctant reader",
    themes: [],
    formats: ["Hi-Lo", "Graphic Novel", "Chapter Book", "Includes Illustrations"],
    reduce: [],
    terms: ["illustrated", "short", "easy", "accessible", "engaging"],
    seriesHint: null,
  },
  {
    id: "like-geronimo-stilton",
    label: "Like Geronimo Stilton",
    query: "Like Geronimo Stilton",
    themes: ["Humor, Poetry & Verse", "Action, Adventure & Mystery"],
    formats: [],
    reduce: [],
    terms: ["geronimo", "stilton", "mouse", "reporter", "funny", "adventure"],
    seriesHint: "Geronimo Stilton",
  },
  {
    id: "weekend-read",
    label: "A weekend read",
    query: "A weekend read",
    themes: [],
    formats: ["Chapter Book"],
    reduce: [],
    terms: ["chapter", "story", "novel", "read"],
    seriesHint: null,
  },
];

/**
 * Free-text keyword mappings for the deterministic interpreter. This is the
 * fallback path that guarantees the demo works with no language model.
 */
export const THEME_KEYWORDS: Record<string, string[]> = {
  "Action, Adventure & Mystery": [
    "adventure",
    "action",
    "mystery",
    "mysteries",
    "detective",
    "spy",
    "quest",
    "survival",
    "thriller",
  ],
  Animals: [
    "animal",
    "animals",
    "dog",
    "dogs",
    "cat",
    "cats",
    "horse",
    "dinosaur",
    "dragonfly",
    "wildlife",
    "ocean",
    "shark",
  ],
  "Fantasy & Science Fiction": [
    "fantasy",
    "magic",
    "magical",
    "wizard",
    "dragon",
    "space",
    "alien",
    "robot",
    "science fiction",
    "sci-fi",
    "myth",
  ],
  "Humor, Poetry & Verse": [
    "funny",
    "humor",
    "humour",
    "hilarious",
    "silly",
    "laugh",
    "joke",
    "comedy",
    "poetry",
    "verse",
  ],
  "Family, Friends & School": [
    "friend",
    "friends",
    "friendship",
    "family",
    "school",
    "sibling",
    "brother",
    "sister",
    "classroom",
    "bully",
  ],
  "Science, Technology & Math": [
    "science",
    "stem",
    "math",
    "technology",
    "engineering",
    "experiment",
    "coding",
    "invention",
    "nature",
  ],
  "Biographies & History": [
    "history",
    "historical",
    "biography",
    "biographies",
    "real",
    "true story",
    "war",
    "ancient",
    "president",
  ],
  Sports: [
    "sport",
    "sports",
    "baseball",
    "basketball",
    "soccer",
    "football",
    "hockey",
    "gymnastics",
    "athlete",
  ],
  "People, Places & Society": [
    "culture",
    "community",
    "society",
    "world",
    "country",
    "city",
    "people",
  ],
  "Arts & Entertainment": ["art", "music", "drawing", "dance", "theater", "craft"],
  Transportation: ["car", "cars", "train", "truck", "plane", "vehicle"],
};

export const FORMAT_KEYWORDS: Record<string, string[]> = {
  "Graphic Novel": ["graphic novel", "graphic novels", "comic", "comics", "manga"],
  "Chapter Book": ["chapter book", "chapter books", "novel"],
  "Picture Book": ["picture book", "picture books"],
  "Includes Illustrations": ["illustrated", "illustrations", "pictures"],
  "Hi-Lo": ["reluctant reader", "reluctant", "struggling reader", "easy read"],
  "Novel in Verse": ["novel in verse", "verse"],
};

/**
 * Phrases that express what the parent wants LESS of. Detecting these is what
 * lets "a funny mystery that isn't too scary" work without a language model.
 */
export const REDUCE_KEYWORDS: Record<string, string[]> = {
  scary: [
    "not too scary",
    "isn't too scary",
    "isnt too scary",
    "not scary",
    "nothing scary",
    "no horror",
    "not frightening",
    "less scary",
  ],
  sad: ["not sad", "nothing sad", "no death", "not depressing"],
  long: ["not too long", "short", "quick read", "not long"],
  romance: ["no romance", "not romantic"],
};

/**
 * Terms that identify content a parent asked to see less of. Only concepts we
 * can actually detect in catalog text appear here - "not too long" is
 * deliberately absent because the feed carries no length signal to ground it.
 */
export const REDUCE_CONCEPT_TERMS: Record<ReduceConcept, string[]> = {
  scary: [
    "scary",
    "horror",
    "frightening",
    "terrifying",
    "terror",
    "creepy",
    "haunted",
    "ghost",
    "ghosts",
    "monster",
    "monsters",
    "nightmare",
    "spooky",
    "zombie",
    "paranormal",
    // A parent asking for "not too scary" does not want a murder puzzle book
    // as the top result, which is exactly what these omissions produced.
    "murder",
    "killer",
    "gore",
    "gruesome",
    "sinister",
    "menacing",
  ],
  sad: ["death", "dying", "grief", "mourning", "funeral", "tragedy"],
  romance: ["romance", "romantic", "crush", "dating", "boyfriend", "girlfriend"],
};

/** Terms that carry no discriminating signal in a children's book catalog. */
export const STOPWORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "book", "books", "but",
  "by", "can", "for", "from", "has", "have", "he", "her", "his", "how", "i",
  "in", "into", "is", "it", "its", "like", "me", "my", "of", "on", "one", "or",
  "our", "out", "she", "so", "some", "something", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "to", "up", "want", "was",
  "we", "were", "what", "when", "which", "who", "will", "with", "would", "you",
  "your", "read", "reading", "reader", "kid", "kids", "child", "children",
  "story", "stories", "new", "york", "times", "bestselling", "bestseller",
  "series", "author", "illustrated", "illustrator", "perfect", "great", "young",
]);
