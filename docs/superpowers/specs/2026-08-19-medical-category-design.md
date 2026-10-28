# Medical research category via PubMed

## Problem

Prism only pulls from arXiv. The user wants a "medical research" category —
things like cancer breakthroughs — but arXiv doesn't host clinical medicine;
its `q-bio` section is quantitative/computational biology (genomics,
molecular networks, neuroscience), not clinical or cancer research. Real
medical literature lives on PubMed.

## Goal

Add a "Medical" category group, sourced from PubMed (NCBI E-utilities)
instead of arXiv, that fits into the existing category-switcher /
paper-list / date-picker UI with minimal special-casing.

## Non-goals

- No PDF-availability detection (PMC open-access lookup). PubMed papers
  link out to the PubMed abstract page only — no attempt to find a free
  PDF.
- No separate "new today" feed for PubMed. "Today" is just a date-range
  query where `mindate = maxdate = today` — the same code path used for
  browsing a past date, not a second fetch mode.
- No NCBI API key requirement. Runs under the public 3 req/sec limit.
- No automated test suite exists in this repo; verification is manual,
  consistent with the rest of the project (see the date-picker spec).

## Existing duplication being fixed

Category metadata is currently duplicated three ways: `CategorySelector.tsx`
(`GROUPS`), `PapersClient.tsx` (`CATEGORY_NAMES`), and `stats/route.ts`
(`CATEGORIES`). Adding a fourth list for PubMed would make this worse, so
this work consolidates all of it into one registry that both arXiv and
PubMed categories live in.

## Category registry — `lib/categories.ts` (new)

Single source of truth, replacing the three duplicated lists:

```ts
interface CategoryDef {
  id: string;          // e.g. 'cs.AI' or 'med.ONC'
  label: string;        // display label
  group: string;         // 'AI & ML', 'Medical', etc.
  provider: 'arxiv' | 'pubmed';
  query?: string;        // PubMed search query; unused for arxiv
}
```

The 24 existing arXiv entries move here unchanged, grouped exactly as today
(AI & ML, Physics, Biology, Math, Finance). New group, inserted after
Biology:

| id | label | group | PubMed query (MeSH major topic) |
|---|---|---|---|
| `med.ONC` | Oncology | Medical | `cancer[Majr] OR neoplasms[Majr]` |
| `med.CARD` | Cardiology | Medical | `cardiovascular diseases[Majr]` |
| `med.NEURO` | Neurology | Medical | `nervous system diseases[Majr]` |
| `med.ID` | Infectious Disease | Medical | `communicable diseases[Majr]` |
| `med.IMMUNO` | Immunology | Medical | `immune system diseases[Majr]` |

`[Majr]` (MeSH *major topic*) restricts results to papers actually about
that topic, not just mentioning it — keeps results focused, similar to how
arXiv's category tagging works today.

`CategorySelector.tsx` builds its `GROUPS` UI by grouping registry entries
by `group` instead of the inline array. `PapersClient.tsx`'s
`CATEGORY_NAMES` lookup becomes `categories.find(c => c.id === category).label`
(or a `Record` built once from the registry).

## Provider abstraction — `lib/providers/`

Both providers implement the same interface:

```ts
interface Provider {
  fetchFeed(category: string, date: string | null, start: number, maxResults: number, retries?: number):
    Promise<{ papers: Paper[]; total: number }>;
  fetchCount(category: string, date: string | null): Promise<number>;
  sweepSpacingMs: number; // pacing for the date-picker's per-category count sweep
}
```

### `lib/providers/arxiv.ts`

Today's logic from `app/api/papers/route.ts` and `app/api/stats/route.ts`,
moved here unchanged: RSS feed for "today" (no `date`), the
`submittedDate`-range query API for a picked date, `fetchArxivXml` retry
behavior preserved. `sweepSpacingMs: 3500` (unchanged — arXiv's search API
rate-limits to ~1 req/3s, confirmed while building the date picker).

### `lib/providers/pubmed.ts` (new)

Always queries by date range — no separate "today" mode:

1. `esearch.fcgi`: `db=pubmed&term={category.query}&datetype=pdat&mindate={date}&maxdate={date}&sort=date&retstart={start}&retmax={maxResults}&retmode=json`
   (`date` defaults to today when the caller passes `null`). Returns the
   matching PMIDs and a total count (`esearchresult.count`) — this alone
   is enough for `fetchCount`.
2. `efetch.fcgi`: `db=pubmed&id={pmids.join(',')}&rettype=abstract&retmode=xml`
   for the PMIDs from step 1, to get full records.
3. Parse each `PubmedArticle` with `fast-xml-parser`: `ArticleTitle` →
   `title`, `AbstractText` → `abstract` (run through `cleanLatexText` like
   arXiv text, since PubMed abstracts can contain similar markup
   artifacts), `AuthorList.Author` (`LastName`/`ForeName`) → `authors`,
   `PubDate` → `published`/`updated`, PMID → `id`.
   `absUrl = https://pubmed.ncbi.nlm.nih.gov/{pmid}/`; `pdfUrl` omitted
   (see Paper model below).
4. No API key; `sweepSpacingMs: 400`, safely under NCBI's public 3 req/sec
   cap.
5. Same retry/timeout shape as `fetchArxivXml` (bounded attempt timeout +
   1-2 backoff retries) — reused pattern, not reused code, since the two
   APIs have different failure shapes.

## Route changes

- `app/api/papers/route.ts`: look up the category's provider from the
  registry (400 if the category id isn't in the registry — replaces
  today's regex-only validation), delegate to `provider.fetchFeed(...)`.
  Response shape (`{ papers, total, category, date? }`) is unchanged from
  the caller's perspective.
- `app/api/stats/route.ts`: iterate all registry entries (not a hardcoded
  arXiv-only list), call `provider.fetchCount(id, null)` per entry, same
  response shape (`{ counts, grandTotal, categoriesLive, asOf }`).

## Frontend changes — `components/PapersClient.tsx`

The per-category date-sweep effect (today: one flat list of 24 categories,
one fixed 3500ms spacing) becomes provider-aware: group registry entries by
provider, run one sweep loop per provider concurrently, each paced by that
provider's own `sweepSpacingMs`. The medical sweep (5 categories × 400ms)
finishes in ~2s instead of being serialized behind arXiv's ~84s sweep.
`dateCounts` is filled in the same incremental way regardless of which
loop wrote it — no change to how `Hero`/`CategorySelector` consume it.

## Paper model & UI — `components/PaperCard.tsx`

`Paper` interface: add `source: 'arxiv' | 'pubmed'`; `pdfUrl` becomes
optional (`pdfUrl?: string`), populated only for arXiv.

Action row becomes source-aware:
- `source === 'arxiv'` (today's UI, unchanged): "PDF ↗" (`pdfUrl`) +
  "arXiv ↗" (`absUrl`) buttons.
- `source === 'pubmed'`: single "View on PubMed ↗" button → `absUrl`.

AI Summary (`/api/summarize`) and cover-image generation (`/api/cover`)
need no changes — both already operate on just `title`/`abstract`, which
both providers populate the same way.

## Error handling

Same pattern as the existing arXiv path: fetch/parse failures are caught,
logged server-side, surfaced via the existing "Failed to fetch papers" /
empty-state UI. No new error-handling paths — `fetchCount` failures for a
single PubMed category during the stats sweep leave that chip at "—",
exactly like a failed arXiv category does today.

## Testing / verification

No automated test framework exists in this repo. Verify manually:

- `/api/papers?category=med.ONC` and `/api/stats` return well-formed
  responses (spot-check a couple of the other `med.*` ids too).
- Medical group appears in the category strip after Biology, with working
  chip counts.
- Selecting a medical category loads papers, cover-image generation and AI
  Summarize both work on a PubMed paper.
- PubMed paper card shows the single "View on PubMed ↗" button (no PDF
  button); arXiv cards are unchanged.
- Date picker works for a medical category (mindate=maxdate=picked date),
  including "Load more" pagination.
- Switching between an arXiv and a medical category, and toggling the date
  picker, doesn't cross-contaminate `counts`/`dateCounts` between sources.
