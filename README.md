# HDS Book Discovery Experiment

An independent experiment derived from the HDS Kids Books Discovery prototype.
This repository starts from a clean source snapshot, not a GitHub fork or the
original project's commit history. It is intended for feedback-driven iteration;
the original repository and deployment are maintained separately.

## Current experience

- Start on the personalized demo landing page (`/`). Ask anything retains
  honest books-only assessment; pizza shopping is unsupported, while books
  about cooking remain supported. Photo tiles and off-path controls are
  explicit coming-soon features, not shopping functionality.
- **My things** (`/my-things`) holds saved filters and Continue discovering,
  alongside clearly labeled personal-SKU and list placeholders.
- Discovery (`/discover`) shows **Filter – {name}** with fixed qualifiers,
  one replaceable text string and one example book. Updating words preserves
  the book and negative feedback. Short labels are deterministic display
  text only: the full request reaches the unchanged interpreter.
- Select one book with **Add to Filter**, or combine it with words. Internally
  this is the single similarity pivot: another selection replaces it rather
  than accumulating books. Removing it is not “Fewer like this” feedback.
- **Save this filter** (or **Save as a new filter**) creates a browser-local recipe:
  request text, added preferences, source context and at most one book ID.
  Cart, “Fewer like this” and result order are not saved. Opening a filter copies
  its recipe; later working changes do not update it automatically.
- **Clear Filter** resets the working context while preserving saved filters
  and Cart. Home suggestions populate the input without submitting. Continue
  discovering appears for an active Filter or a remembered browsing position.
- Edit or remove either input independently in **Filter**.
- Filter state and matching results update together, with recoverable errors.
- Browse paginated recommendations, book details, and a separate demo cart.
- One responsive Filter ribbon sits above the full-width result grid and
  collapses while browsing. Counts distinguish loaded books from the server's
  total ranked candidates; they are not a guaranteed matching total.
- Optional OpenRouter interpretation falls back to deterministic interpretation.
- Checkout is a demonstration: it does not collect payments.

The initial public snapshot is tagged `feedback-baseline`.
The seeded “Books for Johnny” Mode carries age context, not enforced
personalization. Catalog grades are information about the available feed;
age, price, length and safety requests are not hard eligibility constraints.

### Presenter demo

Landing → My things → Filter – Books for Johnny → replace words → select an
example book → product detail → Add to cart → save a filter. The cart badge
always reflects real session quantities; no demo items are seeded.

Settings → Reset demo clears only `hds_pf_` keys in localStorage and
sessionStorage, then fully reloads the app. A fresh session has an empty Cart
and exactly one seeded Books for Johnny filter. It does not call the disabled
server reset endpoint. This reset deliberately removes browser-local saved
filters; ordinary Clear Filter does not.

UI “filter” maps to the existing internal `Mode` recipe and storage keys;
“My filters” is the saved Mode collection. The underlying additive refinement
API and recipe format remain intact, but this screen uses replacement only.

New releases use publication years, not arrival dates: the inspected catalog
has years for 2,370/2,370 books and its newest years are 2025–2026 (1,501 books).
The section selects at most eight qualifying books from the first loaded page,
retains ranking order and hides below three. It never changes ranking or the
main grid. `publicationYear` is an optional nullable API field.

The app shares a light navy/red Inter theme; photography is confined to the
landing page. Seven original WebP images live in `public/landing`, each below
200 KB. The reviewed public export remains **text-only**: images are excluded,
and the UI supplies soft-color fallbacks when they are unavailable.

Final palette: navy `#1C2758` (14.18:1 on white), secondary text `#4A5675`
(7.29:1 white; at least 6.02:1 on the header stops), red button and badge
`#D12F22` (white text 5.07:1), logo `#E5392B`, errors `#9E2119`,
focus `#1769AA`, input outlines `#7F90AE` (3.23:1 white), decorative border
`#C9D4E5`, card border `#DCE4F0`, surfaces `#F2F6FC`, header
`#DDEBFA` → white → `#FCE6DA`, decorative rule `#8EC5F0`.
The logo red is reserved for large bold lettering; small text uses navy.

Reset storage inventory: `hds_pf_experiment_session_id`,
`hds_pf_demo_user_modes`, `hds_pf_demo_user_modes.unreadable`,
`hds_pf_working_context` and sessionStorage `hds_pf_home_draft`;
prefix-based removal also catches future demo keys. Coming-soon controls are
landing products/categories, attachment/microphone, delivery, user/agent
switching, and the placeholder filters, personal SKUs and lists.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `artifacts/hds-books` | React + Vite frontend |
| `artifacts/api-server` | Express API and recommendation engine |
| `lib/api-spec` | OpenAPI source and client generation |
| `lib/api-client-react`, `lib/api-zod` | Generated client and validation |
| `lib/db` | PostgreSQL schema and Drizzle configuration |
| `lib/pricing` | Shared pricing calculations |
| `scripts` | Catalog import, checks, and public-source export tooling |

The supplier catalog, shopper/session data, internal product/design documents,
design sandbox, credentials, and workspace/checkpoint history are **not included**.
An authorized catalog and a new development database are required to browse books.

## Development setup

Prerequisites: Node.js 24, pnpm 10, and PostgreSQL. The dependency overrides in
`pnpm-workspace.yaml` target Linux x64; other platforms may require adjustments.

1. Install dependencies: `pnpm install --frozen-lockfile`.
2. Configure `DATABASE_URL` securely for a new development database. Optionally
   set `OPENROUTER_API_KEY` for language interpretation and administrative
   enrichment. Do not commit credentials. Supply variables through your process
   environment; commands do not universally load `.env` files automatically.
3. Initialize only that new database:

   ```sh
   pnpm --filter @workspace/db run push
   ```

4. Obtain permission to use a compatible supplier XML feed and place it privately
   at the `SOURCE_FILE` path defined in `scripts/src/import-catalog.ts`:
   `data/2026.08.14_Books_kids-grade_5-6_1787316321677.xml`.
   The `data/` directory is excluded from public exports and ignored by Git.
   The importer defines the expected field structure; do not substitute an
   incompatible XML format or redistribute a feed without permission.
5. Import into the new database:

   ```sh
   pnpm --filter @workspace/scripts run import-catalog
   ```

   **Destructive operation:** the importer replaces product rows. Never point it
   at an existing production or shared database. Importing is not a migration.
6. Start the API and frontend with a same-origin reverse proxy:

   ```sh
   PORT=8080 pnpm --filter @workspace/api-server run dev
   PORT=5173 BASE_PATH=/ pnpm --filter @workspace/hds-books run dev
   ```

   Route `/api` to the API and other paths to Vite. Two separate ports alone do
   not provide that routing. In the existing Replit workspace, the configured
   artifact services already provide routing and the required port/base variables;
   the service definitions are included. This export does not provision a
   database, copy secrets, or configure a deployment automatically.

Subject summaries are optional cached administrative enrichment, not live page
generation. Without an OpenRouter key, the app uses deterministic interpretation
and Topics. See the administrative source in `artifacts/api-server/src/admin`
before running enrichment; it can incur external API costs.

## Checks

```sh
pnpm run typecheck
pnpm test
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/hds-books run build
pnpm --filter @workspace/api-server run build
```

After intentionally changing the API specification, regenerate clients with
`pnpm --filter @workspace/api-spec run codegen`. Integration tests requiring a
live API/catalog are separate from the unit tests; use a disposable environment.

For an isolated unit-test run without a database, the DB module still requires
a nonempty URL at import time. With real credentials and API keys removed from
the test process environment, use a process-only placeholder:
`DATABASE_URL=postgresql://127.0.0.1:1/unit_test pnpm test`.
The unit suite uses in-memory fixtures and does not require a listening database.
Do not use this placeholder to start the app or run the live integration tests.

## Publishing source changes safely

Public source destination:
`https://github.com/narainio/hds-book-discovery-experiment`.

From the remix workspace, run:

```sh
node scripts/public-export.mjs
```

This prepares `.local/public-export/snapshot/` and hashed JSON upload batches from
the exact reviewed paths in `public-export-files.json`. It reads the working tree,
not checkpoint history, and does not upload or push anything. Review the diff and
scan the contents before each publication; pattern checks are not a guarantee
that a file is safe to publish. New files require an explicit allowlist change.
Removed files must be removed from that list deliberately.

For an Agent-assisted update, request a reviewed source-only snapshot update to
this repository. Use the GitHub API to create blobs and a complete tree, verify
its paths and hashes against the export manifest, then create a commit whose
parent is the current public `main` commit. With explicit authorization, publish
that commit on a new feature branch and open a pull request into `main`; do not
update `main` directly or force-push. After review and separately approved merge,
tag the merged milestone without moving `feedback-baseline`.
This also preserves deletions and public history. Do not copy the remix's `.git`
directory or push its checkpoint branches. No automatic GitHub sync is enabled
in the remix, and no GitHub push remote is attached to its checkpoint repository.

In a separate clean clone of this public repository, normal feature branches and
pull requests are appropriate. Never add private data or secrets, even temporarily.
The original project's repository is not a push destination for this experiment.

## Rights and scope

Public visibility does not establish permission to redistribute supplier feeds,
book covers, or third-party content. No new license is selected by this export;
existing source/package notices are preserved. Review applicable rights before
reuse or redistribution.
