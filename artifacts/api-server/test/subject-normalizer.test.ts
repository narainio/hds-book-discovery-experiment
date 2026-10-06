import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDisplayTopics,
  getApprovedSubjectTags,
  SUBJECT_NORMALIZER_VERSION,
} from "../src/domain/subject-normalizer.js";

test("exports a stable normalizer version", () => {
  assert.equal(SUBJECT_NORMALIZER_VERSION, "1");
});

test("preserves geographic adjectives in historical Topics", () => {
  assert.deepEqual(buildDisplayTopics({
    subjects: ["Biographies & History > 20th Century European History"],
    tags: [],
  }), ["20th century European history"]);
});

test("splits hierarchy, cleans whitespace, maps labels, and removes ancestors", () => {
  assert.deepEqual(
    buildDisplayTopics({
      subjects: [
        " STEM  > Math & Technology > Engineering & Technology > Computers & Digital Media > Coding & Programming ",
      ],
      tags: [],
    }),
    ["Coding and technology"],
  );
});

test("normalizes the representative parents path without dumping ancestors", () => {
  assert.deepEqual(
    buildDisplayTopics({
      subjects: [
        "Family, Friends & School > My Family & Me > Family Members > Parents",
      ],
      tags: [],
    }),
    ["Parents"],
  );
});

test("deduplicates canonical equivalents and uses sentence case", () => {
  assert.deepEqual(
    buildDisplayTopics({
      subjects: [
        "Humor, Poetry & Verse > Humor > Funny Stories",
        "Humor > Humorous Stories",
        "Transportation > LAND TRANSPORTATION > CARS & TRUCKS",
      ],
      tags: [],
    }),
    ["Humor", "Cars and trucks"],
  );
});

test("preserves recognized proper names and terms in sentence case", () => {
  assert.deepEqual(
    buildDisplayTopics({
      subjects: [
        "People, Places & Society > Places > NEW YORK",
        "Biographies & History > History > WORLD WAR II",
        "STEM > SPACE > SPACE EXPLORATION",
      ],
      tags: [],
    }),
    ["New York", "World War II", "Space exploration"],
  );
});

test("selects diverse branches deterministically and caps rich input at six", () => {
  const input = {
    subjects: [
      "Action, Adventure & Mystery > Action & Adventure",
      "Action, Adventure & Mystery > Mysteries & Thrillers > Mysteries & Detective Stories",
      "Animals > Amphibians & Reptiles > Alligators & Crocodiles",
      "People, Places & Society > Places > Neighborhood & Community > City & Town Life",
      "Animals > Mammals > Rodents > Mice & Rats",
      "Humor, Poetry & Verse > Humor > Funny Stories",
      "STEM > Space > Planets & Stars",
    ],
    tags: ["Graphic Novel"],
  };

  const expected = [
    "Action and adventure",
    "Alligators and crocodiles",
    "City life",
    "Humor",
    "Planets and stars",
    "Mysteries",
  ];
  assert.deepEqual(buildDisplayTopics(input), expected);
  assert.deepEqual(buildDisplayTopics(input), expected);
});

test("uses a meaningful broad fallback only when no descendant is available", () => {
  assert.deepEqual(
    buildDisplayTopics({ subjects: ["Animals", "People, Places & Society > Society"], tags: [] }),
    ["Animals", "Society"],
  );
  assert.deepEqual(
    buildDisplayTopics({
      subjects: ["Animals", "Animals > Mammals > Dogs & Canines > Dogs"],
      tags: [],
    }),
    ["Dogs"],
  );
});

test("removes useful ancestors supplied as separate paths", () => {
  assert.deepEqual(
    buildDisplayTopics({
      subjects: [
        "STEM > Math & Technology > Engineering & Technology > Computers & Digital Media",
        "STEM > Math & Technology > Engineering & Technology > Computers & Digital Media > Coding & Programming",
        "Animals > Amphibians & Reptiles",
        "Animals > Amphibians & Reptiles > Alligators & Crocodiles",
      ],
      tags: [],
    }),
    ["Coding and technology", "Alligators and crocodiles"],
  );
});

test("drops purely structural fallback labels and broad filler beside specifics", () => {
  assert.deepEqual(
    buildDisplayTopics({ subjects: ["All", "General", "Other"], tags: [] }),
    [],
  );
  assert.deepEqual(
    buildDisplayTopics({
      subjects: ["STEM", "Animals", "People, Places & Society > Society", "STEM > Space > Planets & Stars"],
      tags: [],
    }),
    ["Planets and stars"],
  );
});

test("retains meaningful ampersands unless a catalog label has an explicit mapping", () => {
  assert.deepEqual(
    buildDisplayTopics({
      subjects: ["Arts, Crafts & Music > Music > R&B", "Transportation > Cars & Trucks"],
      tags: [],
    }),
    ["R&B", "Cars and trucks"],
  );
});

test("does not invent topics and ignores malformed path segments", () => {
  assert.deepEqual(
    buildDisplayTopics({
      subjects: ["  > > ;;; > ", "-", "STEM > > Rocks & Minerals >>> "],
      tags: ["Vertical Placement Completed", "Hi-Lo", "On Sale", "Unknown Claim"],
    }),
    ["Rocks and minerals"],
  );
  assert.deepEqual(buildDisplayTopics({ subjects: [], tags: [] }), []);
});

test("normalizes the actual Dear Dad feed example", () => {
  assert.deepEqual(
    buildDisplayTopics({
      subjects: [
        "STEM > Math & Technology > Engineering & Technology > Computers & Digital Media > Coding & Programming",
        "Family, Friends & School > My Family & Me > Family Members > Parents",
        "Family, Friends & School > My Family & Me > Being Me > Growing Up > Coming of Age",
        "Biographies & History > Biographies & Memoirs",
        "People, Places & Society > Society",
      ],
      tags: [
        "Graphic Novel",
        "Informational Text",
        "Community Voices",
        "Includes Back Matter",
        "Vertical Placement Completed",
      ],
    }),
    ["Coding and technology", "Parents", "Biography and memoir", "Growing up"],
  );
});

test("allows only explicit customer-relevant tags and omits graphic format as a topic", () => {
  assert.deepEqual(
    getApprovedSubjectTags([
      " Graphic Novel ",
      "Humorous stories",
      "Includes Illustrations",
      "Graphic Novel",
      "School Books",
      "Hi-Lo",
      "Geronimo Stilton",
    ]),
    ["Graphic novel", "Humor", "Includes illustrations"],
  );
  assert.deepEqual(
    buildDisplayTopics({
      subjects: [],
      tags: ["Graphic Novel", "Memoir", "Includes Illustrations", "School Books"],
    }),
    ["Memoir", "Includes illustrations"],
  );
});