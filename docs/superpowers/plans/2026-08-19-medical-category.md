# Medical Research Category (PubMed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Medical" category group (Oncology, Cardiology, Neurology, Infectious Disease, Immunology), backed by PubMed instead of arXiv, that fits into the existing category-switcher / paper-list / date-picker UI without regressing any arXiv behavior.

**Architecture:** A single category registry (`lib/categories.ts`) replaces three currently-duplicated category lists (`CategorySelector.tsx`, `PapersClient.tsx`, `stats/route.ts`) and becomes the source of truth for both arXiv and PubMed categories. Two provider modules (`lib/providers/arxiv.ts`, `lib/providers/pubmed.ts`) implement a shared `{ fetchFeed, fetchCount }` interface; `app/api/papers/route.ts` and `app/api/stats/route.ts` look up each category's provider from the registry instead of hardcoding arXiv. The PubMed provider calls NCBI's E-utilities (`esearch` + `efetch`), always by date range (no separate "today" mode — "today" is just `mindate=maxdate=today`).

**Tech Stack:** Next.js 14 App Router API routes, `fast-xml-parser` (already a dependency, used for both arXiv and the new PubMed XML), React state in an existing client component. No test framework exists in this repo (confirmed: no jest/vitest config, no `*.test.*` files, no `test` script in `package.json`) — verification is `npx tsc --noEmit`, `npm run build`, direct `curl` checks against the real NCBI/arXiv APIs and the local dev server, and manual browser checks — consistent with how the date-picker feature was verified.

**Spec:** `docs/superpowers/specs/2026-08-19-medical-category-design.md`

## Global Constraints

- Medical categories (5), in this exact order, inserted as a "Medical" group after "Biology": `med.ONC` Oncology (`cancer[Majr] OR neoplasms[Majr]`), `med.CARD` Cardiology (`cardiovascular diseases[Majr]`), `med.NEURO` Neurology (`nervous system diseases[Majr]`), `med.ID` Infectious Disease (`communicable diseases[Majr]`), `med.IMMUNO` Immunology (`immune system diseases[Majr]`).
- No PMC/free-PDF detection — PubMed paper cards always link to the PubMed abstract page only (single button), never a separate PDF link.
- No separate "today" mode for PubMed — `mindate=maxdate=today` when `date` is `null`, same code path as browsing a specific past date.
- No NCBI API key required (public rate limit: 3 req/sec). PubMed's date-picker sweep spacing is 400ms/category vs arXiv's existing 3500ms/category — verified live against `eutils.ncbi.nlm.nih.gov`.
- `fast-xml-parser` does **not** decode numeric XML character references (e.g. `&#x207a;` → ⁺) — only named entities (`&amp;` etc). Verified directly: `parser.parse('<x>&#x207a;</x>')` returns the literal `"&#x207a;"` unchanged. PubMed abstracts use these heavily; arXiv's feeds don't need this. A dedicated `lib/xmlEntities.ts` decodes them.
- Inline formatting tags (`<i>`, `<b>`, `<sup>`, `<sub>`, `<u>`) inside PubMed's `<AbstractText>`/`<ArticleTitle>` are stripped from the raw XML string *before* parsing. Verified: without stripping, `fast-xml-parser` turns a field like `...using <i>ex vivo</i> co-cultures...` into a nested object and the reassembled text loses words/spacing (`"...using co-cultures..."`, dropping "ex vivo" and the space). Stripping the tags first keeps the surrounding text exactly intact.
- `published`/`updated` for PubMed papers is set to the queried date (`${dateStr}T00:00:00Z`), not parsed from PubMed's own `PubDate`/`ArticleDate` fields (which have inconsistent shapes — string month names, missing days, occasional free-text `MedlineDate`). The app only needs a displayable date consistent with which date-bucket the paper was surfaced under, and the provider is always queried with `mindate=maxdate=that exact date` — deliberate simplification, not a bug.
- Deviation from the spec's Provider interface sketch: `fetchCount` takes only `category` (no `date` param) — the routing in `stats/route.ts` only ever needs "now" per category, so the unused parameter is dropped (YAGNI). `sweepSpacingMs` lives in `lib/categories.ts` as an exported `SWEEP_SPACING_MS` map rather than as a property on the `Provider` object, so `PapersClient.tsx` (a client component) doesn't need to import the provider modules — which pull in server-side fetch/retry logic — just to read a constant.
- Found while exploring, **out of scope for this plan**: `app/api/cover/route.ts:133` hardcodes the same deprecated `llama-3.1-8b-instant` Groq model already fixed in `app/api/summarize/route.ts`. Not touched here (unrelated feature) — flag to the user after this plan lands. This plan does guard `PaperCard.tsx`'s call into that route so a PubMed paper's PMID is never sent as `arxivId` (Task 5).
- Existing `/^[a-zA-Z0-9.\-]+$/` category-string validation in `app/api/papers/route.ts` is replaced by a registry lookup (`getCategory(category)` must return a match, else `400`). This is stricter (whitelist instead of a permissive regex) but safe: every category the UI ever sends comes from `CategorySelector.tsx`, which will only ever render registry entries after Task 1.

---

## Task 1: Category registry, consuming it from the UI (arXiv-only, no behavior change)

**Files:**
- Create: `lib/categories.ts`
- Modify: `components/CategorySelector.tsx`
- Modify: `components/PapersClient.tsx:9-34` (the inline `CATEGORY_NAMES` map)

**Interfaces:**
- Produces: `CategoryDef { id, label, group, provider: 'arxiv' | 'pubmed', query?: string }`, `ProviderName = 'arxiv' | 'pubmed'`, `CATEGORIES: CategoryDef[]`, `SWEEP_SPACING_MS: Record<ProviderName, number>`, `getCategory(id: string): CategoryDef | undefined`, `categoryLabels(): Record<string, string>`, `categoryGroups(): { label: string; categories: CategoryDef[] }[]`.
- Consumes: nothing (leaf data module).

This task only reshuffles where the *existing* 24 arXiv categories live — it must produce byte-identical UI/behavior. Medical categories are added in Task 4, once the provider that serves them exists.

- [ ] **Step 1: Create the registry**

Write `lib/categories.ts`:

```typescript
export type ProviderName = 'arxiv' | 'pubmed';

export interface CategoryDef {
  id: string;
  label: string;
  group: string;
  provider: ProviderName;
  // PubMed esearch `term`. Unused for arxiv categories (their id doubles
  // as the arXiv category code, e.g. 'cs.AI').
  query?: string;
}

export const CATEGORIES: CategoryDef[] = [
  // AI & ML
  { id: 'cs.AI', label: 'cs.AI', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.LG', label: 'cs.LG', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.CV', label: 'cs.CV', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.CL', label: 'cs.CL', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.RO', label: 'cs.RO', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.NE', label: 'cs.NE', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.IR', label: 'cs.IR', group: 'AI & ML', provider: 'arxiv' },
  { id: 'stat.ML', label: 'stat.ML', group: 'AI & ML', provider: 'arxiv' },

  // Physics
  { id: 'quant-ph', label: 'quant-ph', group: 'Physics', provider: 'arxiv' },
  { id: 'cond-mat.mes-hall', label: 'cond-mat', group: 'Physics', provider: 'arxiv' },
  { id: 'hep-th', label: 'hep-th', group: 'Physics', provider: 'arxiv' },
  { id: 'astro-ph.GA', label: 'astro-ph', group: 'Physics', provider: 'arxiv' },
  { id: 'physics.optics', label: 'optics', group: 'Physics', provider: 'arxiv' },

  // Biology
  { id: 'q-bio.NC', label: 'q-bio.NC', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.GN', label: 'q-bio.GN', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.BM', label: 'q-bio.BM', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.QM', label: 'q-bio.QM', group: 'Biology', provider: 'arxiv' },

  // Medical (PubMed) — added in Task 4; kept here as the final registry
  // shape so this file only needs one edit across the whole plan.
  { id: 'med.ONC', label: 'Oncology', group: 'Medical', provider: 'pubmed', query: 'cancer[Majr] OR neoplasms[Majr]' },
  { id: 'med.CARD', label: 'Cardiology', group: 'Medical', provider: 'pubmed', query: 'cardiovascular diseases[Majr]' },
  { id: 'med.NEURO', label: 'Neurology', group: 'Medical', provider: 'pubmed', query: 'nervous system diseases[Majr]' },
  { id: 'med.ID', label: 'Infectious Disease', group: 'Medical', provider: 'pubmed', query: 'communicable diseases[Majr]' },
  { id: 'med.IMMUNO', label: 'Immunology', group: 'Medical', provider: 'pubmed', query: 'immune system diseases[Majr]' },

  // Math
  { id: 'math.ST', label: 'math.ST', group: 'Math', provider: 'arxiv' },
  { id: 'math.OC', label: 'math.OC', group: 'Math', provider: 'arxiv' },
  { id: 'math.CO', label: 'math.CO', group: 'Math', provider: 'arxiv' },
  { id: 'math.PR', label: 'math.PR', group: 'Math', provider: 'arxiv' },

  // Finance
  { id: 'q-fin.TR', label: 'q-fin.TR', group: 'Finance', provider: 'arxiv' },
  { id: 'q-fin.PM', label: 'q-fin.PM', group: 'Finance', provider: 'arxiv' },
  { id: 'q-fin.RM', label: 'q-fin.RM', group: 'Finance', provider: 'arxiv' },
];

// Pacing for the date-picker's per-category count sweep (PapersClient.tsx).
// arXiv's search API rate-limits to ~1 req/3s (verified while building the
// date picker). NCBI's public E-utilities limit is 3 req/sec unauthenticated
// — 400ms/category stays safely under that.
export const SWEEP_SPACING_MS: Record<ProviderName, number> = {
  arxiv: 3500,
  pubmed: 400,
};

export function getCategory(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function categoryLabels(): Record<string, string> {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
}

export interface CategoryGroup {
  label: string;
  categories: CategoryDef[];
}

export function categoryGroups(): CategoryGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, CategoryDef[]>();
  for (const cat of CATEGORIES) {
    if (!byGroup.has(cat.group)) {
      byGroup.set(cat.group, []);
      order.push(cat.group);
    }
    byGroup.get(cat.group)!.push(cat);
  }
  return order.map((label) => ({ label, categories: byGroup.get(label)! }));
}
```

- [ ] **Step 2: Point `CategorySelector.tsx` at the registry**

Replace the full contents of `components/CategorySelector.tsx` with:

```tsx
'use client';

import { categoryGroups } from '@/lib/categories';

interface Props {
  selected: string;
  onChange: (category: string) => void;
  counts?: Record<string, number>;
  countsLoading?: boolean;
  date?: string | null;
}

const GROUPS = categoryGroups();

export default function CategorySelector({
  selected,
  onChange,
  counts = {},
  countsLoading = false,
  date = null,
}: Props) {
  return (
    <div className="cat-strip">
      <div className="cat-strip-inner">
        {GROUPS.map((group) => (
          <div key={group.label} className="cat-row">
            <span className="cat-group-lbl" aria-hidden="true">
              {group.label}
            </span>
            {group.categories.map((cat) => {
              const count = counts[cat.id];
              const hasCount = typeof count === 'number';
              return (
                <button
                  key={cat.id}
                  role="tab"
                  aria-selected={selected === cat.id}
                  className={`cat-btn${selected === cat.id ? ' active' : ''}`}
                  onClick={() => onChange(cat.id)}
                  title={
                    hasCount
                      ? date
                        ? `${cat.label} — ${count.toLocaleString()} papers on ${date}`
                        : `${cat.label} — ${count.toLocaleString()} new today`
                      : cat.label
                  }
                >
                  <span className="cat-btn-code">{cat.label}</span>
                  <span
                    className={`cat-btn-count${countsLoading && !hasCount ? ' loading' : ''}`}
                  >
                    {hasCount ? count.toLocaleString() : countsLoading ? '·' : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

(Identical rendering/classNames to before — only the data source changed, from the inline `GROUPS` array to `categoryGroups()`. `cat.code` became `cat.id`/`cat.label` since `CategoryDef` doesn't have a separate `code` field — arXiv entries already have `id === label`, so this is a no-op for them.)

- [ ] **Step 3: Point `PapersClient.tsx`'s `CATEGORY_NAMES` at the registry**

In `components/PapersClient.tsx`, add the import alongside the existing ones (top of file):

```typescript
import { categoryLabels } from '@/lib/categories';
```

Then replace the inline `CATEGORY_NAMES` object literal (currently lines 9-34) with:

```typescript
const CATEGORY_NAMES: Record<string, string> = categoryLabels();
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification — arXiv-only behavior unchanged**

With the dev server running (`npm run dev`):
1. Load `http://localhost:3000` — the category strip must render identically to before: same groups (AI & ML, Physics, Biology, Math, Finance — **Medical does not appear yet**, since no provider serves it until Task 4), same codes, same counts.
2. Click through a couple of categories — papers load exactly as before.

- [ ] **Step 6: Commit**

```bash
git add lib/categories.ts components/CategorySelector.tsx components/PapersClient.tsx
git commit -m "$(cat <<'EOF'
Introduce a single category registry, replacing three duplicated lists

CategorySelector's GROUPS, PapersClient's CATEGORY_NAMES, and stats/
route's CATEGORIES were three independent copies of the same 24
category codes. lib/categories.ts is now the one source of truth (the
stats route switches over in a later commit). Pure refactor — no
behavior change; the registry already carries the 5 upcoming medical
categories, but nothing serves them yet.
EOF
)"
```

---

## Task 2: Provider abstraction — extract arXiv's existing logic behind a shared interface

**Files:**
- Create: `lib/providers/types.ts`
- Create: `lib/providers/arxiv.ts`
- Create: `lib/providers/index.ts`
- Modify: `app/api/papers/route.ts` (full rewrite)
- Modify: `app/api/stats/route.ts` (full rewrite)

**Interfaces:**
- Produces: `Paper { id, index, title, authors, abstract, published, updated, categories, pdfUrl?, absUrl, source: 'arxiv' | 'pubmed' }`, `FeedResult { papers: Paper[]; total: number }`, `Provider { fetchFeed(category, date, start, maxResults, retries?): Promise<FeedResult>; fetchCount(category): Promise<number> }`, `getProvider(name: ProviderName): Provider`.
- Consumes: `CategoryDef`, `getCategory`, `CATEGORIES`, `ProviderName` from `lib/categories.ts` (Task 1); `fetchArxivXml` from `lib/arxivFetch.ts`; `cleanLatexText` from `lib/cleanText.ts`; `isValidDate`, `MAX_DAYS_BACK` from `lib/dateRange.ts`.

This task moves arXiv's fetch logic verbatim behind the new interface — every request/response byte should be identical to before. PubMed isn't wired in yet (`getProvider('pubmed')` doesn't exist until Task 3/4); this task only proves the abstraction doesn't regress arXiv.

- [ ] **Step 1: Shared types**

Write `lib/providers/types.ts`:

```typescript
export interface Paper {
  id: string;
  index: number;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  updated: string;
  categories: string[];
  // Only arXiv papers have a free PDF. PubMed papers link to the abstract
  // page only (see PaperCard.tsx).
  pdfUrl?: string;
  absUrl: string;
  source: 'arxiv' | 'pubmed';
}

export interface FeedResult {
  papers: Paper[];
  total: number;
}

export interface Provider {
  fetchFeed(
    category: string,
    date: string | null,
    start: number,
    maxResults: number,
    retries?: number
  ): Promise<FeedResult>;
  fetchCount(category: string): Promise<number>;
}
```

- [ ] **Step 2: arXiv provider (moved verbatim from the two route files)**

Write `lib/providers/arxiv.ts`:

```typescript
import { XMLParser } from 'fast-xml-parser';
import { cleanLatexText } from '@/lib/cleanText';
import { fetchArxivXml } from '@/lib/arxivFetch';
import type { Paper, FeedResult, Provider } from './types';

interface RssItem {
  title: string;
  link: string;
  description: string;
  guid: string | { '#text': string };
  pubDate: string;
  'arxiv:announce_type'?: string;
  'dc:creator'?: string;
  category: string | string[];
}

interface AtomAuthor {
  name: string;
}

interface AtomCategory {
  '@_term': string;
}

interface AtomEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  author?: AtomAuthor | AtomAuthor[];
  category?: AtomCategory | AtomCategory[];
}

async function fetchByDate(
  category: string,
  dateStr: string,
  start: number,
  maxResults: number,
  retries?: number
): Promise<FeedResult> {
  const yyyymmdd = dateStr.replace(/-/g, '');
  const searchQuery = `cat:${category}+AND+submittedDate:[${yyyymmdd}0000+TO+${yyyymmdd}2359]`;
  const url =
    `https://export.arxiv.org/api/query?search_query=${searchQuery}` +
    `&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${maxResults}`;

  const xml = await fetchArxivXml(url, retries);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['entry', 'author', 'category'].includes(name),
  });

  const result = parser.parse(xml);
  const entries: AtomEntry[] = result?.feed?.entry ?? [];
  const total = parseInt(result?.feed?.['opensearch:totalResults'] ?? '0', 10) || 0;

  const papers: Paper[] = entries.map((entry, index) => {
    const arxivId = entry.id.replace('http://arxiv.org/abs/', '').replace('https://arxiv.org/abs/', '');

    const authors = (Array.isArray(entry.author) ? entry.author : entry.author ? [entry.author] : [])
      .map((a) => cleanLatexText(a.name))
      .filter(Boolean);

    const categories = (Array.isArray(entry.category) ? entry.category : entry.category ? [entry.category] : [])
      .map((c) => c['@_term'])
      .filter(Boolean);

    return {
      id: arxivId || `paper-${index}`,
      index: start + index + 1,
      title: cleanLatexText(entry.title || ''),
      authors,
      abstract: cleanLatexText(entry.summary || ''),
      published: entry.published,
      updated: entry.updated,
      categories,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
      source: 'arxiv',
    };
  });

  return { papers, total };
}

async function fetchToday(category: string, start: number, maxResults: number): Promise<FeedResult> {
  const url = `https://rss.arxiv.org/rss/${category}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`arXiv RSS returned ${response.status}`);
  }

  const xml = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['item', 'category'].includes(name),
  });

  const result = parser.parse(xml);
  const items: RssItem[] = result?.rss?.channel?.item ?? [];

  const allPapers: Paper[] = items.map((item, index) => {
    const guidStr = typeof item.guid === 'string'
      ? item.guid
      : (item.guid as { '#text': string })?.['#text'] ?? '';
    const arxivId = guidStr.replace('oai:arXiv.org:', '');

    const authors = (item['dc:creator'] ?? '')
      .split(',')
      .map((a: string) => cleanLatexText(a))
      .filter(Boolean);

    const rawDesc = typeof item.description === 'string' ? item.description : '';
    const abstractMatch = rawDesc.match(/Abstract:\s*([\s\S]*)/i);
    const abstract = cleanLatexText(abstractMatch ? abstractMatch[1] : rawDesc);

    const categories = Array.isArray(item.category)
      ? item.category
      : item.category
      ? [item.category]
      : [];

    const absUrl = typeof item.link === 'string' ? item.link : `https://arxiv.org/abs/${arxivId}`;

    return {
      id: arxivId || `paper-${index}`,
      index: index + 1,
      title: cleanLatexText(item.title || ''),
      authors,
      abstract,
      published: item.pubDate,
      updated: item.pubDate,
      categories,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      absUrl,
      source: 'arxiv',
    };
  });

  const papers = allPapers.slice(start, start + maxResults);
  return { papers, total: allPapers.length };
}

async function fetchCount(category: string): Promise<number> {
  try {
    const url = `https://rss.arxiv.org/rss/${category}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
      next: { revalidate: 300 },
    });
    if (!response.ok) return 0;

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['item', 'category'].includes(name),
    });
    const result = parser.parse(xml);
    const items = result?.rss?.channel?.item ?? [];
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

export const arxivProvider: Provider = {
  async fetchFeed(category, date, start, maxResults, retries) {
    return date !== null
      ? fetchByDate(category, date, start, maxResults, retries)
      : fetchToday(category, start, maxResults);
  },
  fetchCount,
};
```

- [ ] **Step 3: Provider registry**

Write `lib/providers/index.ts`:

```typescript
import { arxivProvider } from './arxiv';
import type { Provider } from './types';
import type { ProviderName } from '@/lib/categories';

// pubmedProvider is added in Task 3.
const PROVIDERS: Partial<Record<ProviderName, Provider>> = {
  arxiv: arxivProvider,
};

export function getProvider(name: ProviderName): Provider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`No provider registered for '${name}'`);
  return provider;
}
```

(`Partial` here is deliberate and temporary — Task 4 removes it once `pubmedProvider` is registered too, making every `ProviderName` covered.)

- [ ] **Step 4: Rewire `app/api/papers/route.ts` to use the registry + provider**

Replace the full contents of `app/api/papers/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCategory } from '@/lib/categories';
import { getProvider } from '@/lib/providers';
import { isValidDate, MAX_DAYS_BACK } from '@/lib/dateRange';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'cs.AI';
  const maxResults = Math.min(parseInt(searchParams.get('maxResults') || '20', 10), 50);
  const start = Math.max(parseInt(searchParams.get('start') || '0', 10), 0);
  const date = searchParams.get('date');
  // Callers that space out many requests themselves (the per-category count
  // sweep) opt out of in-request retries — see fetchArxivXml for why
  // retrying here would undermine that external spacing.
  const noRetry = searchParams.get('noRetry') === '1';

  const categoryDef = getCategory(category);
  if (!categoryDef) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  if (date !== null && !isValidDate(date)) {
    return NextResponse.json(
      { error: `Invalid date. Must be YYYY-MM-DD within the last ${MAX_DAYS_BACK} days.` },
      { status: 400 }
    );
  }

  try {
    const provider = getProvider(categoryDef.provider);
    const { papers, total } = await provider.fetchFeed(category, date, start, maxResults, noRetry ? 0 : undefined);
    return NextResponse.json(date !== null ? { papers, total, category, date } : { papers, total, category });
  } catch (error) {
    console.error('[papers] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch papers. Please try again.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Rewire `app/api/stats/route.ts` to use the registry + provider**

Replace the full contents of `app/api/stats/route.ts` with:

```typescript
import { NextResponse } from 'next/server';
import { CATEGORIES } from '@/lib/categories';
import { getProvider } from '@/lib/providers';

export async function GET() {
  try {
    const results = await Promise.all(
      CATEGORIES.map(async (cat) => {
        const provider = getProvider(cat.provider);
        const total = await provider.fetchCount(cat.id);
        return [cat.id, total] as const;
      })
    );

    const counts: Record<string, number> = {};
    let grandTotal = 0;
    for (const [code, total] of results) {
      counts[code] = total;
      grandTotal += total;
    }

    return NextResponse.json({
      counts,
      grandTotal,
      categoriesLive: results.filter(([, t]) => t > 0).length,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[stats] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch category stats.' },
      { status: 500 }
    );
  }
}
```

Note: at this point in the plan, `CATEGORIES` still includes the 5 `med.*` entries from Task 1's registry, but `getProvider('pubmed')` throws (Step 3's `PROVIDERS` map has no `pubmed` key yet). **This step will make `/api/stats` fail** until Task 4 registers `pubmedProvider`. That's expected and fixed two tasks from now — do not skip ahead; Task 3 builds the PubMed provider standalone first, verified independently, before it's wired into anything the running app calls.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Verify arXiv-only paths are unchanged (papers route only — stats is expected to fail until Task 4)**

With the dev server running:

```bash
curl -s "http://localhost:3000/api/papers?category=cs.AI&maxResults=3&start=0" | head -c 300
```
Expected: `{"papers":[...],"total":<n>,"category":"cs.AI"}`, papers include `"source":"arxiv"`.

```bash
curl -s "http://localhost:3000/api/papers?category=cs.AI&maxResults=3&start=0&date=$(date -v-3d +%Y-%m-%d 2>/dev/null || date -d '-3 days' +%Y-%m-%d)" | head -c 300
```
Expected: `{"papers":[...],"total":<n>,"category":"cs.AI","date":"..."}`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/papers?category=not-a-real-category"
```
Expected: `400` (registry rejects unknown categories — stricter than before, but nothing in the app ever sends an unknown category).

- [ ] **Step 8: Commit**

```bash
git add lib/providers/types.ts lib/providers/arxiv.ts lib/providers/index.ts app/api/papers/route.ts app/api/stats/route.ts
git commit -m "$(cat <<'EOF'
Extract arXiv's fetch logic behind a Provider interface

app/api/papers and app/api/stats now look up each category's provider
from the registry instead of hardcoding arXiv's RSS/query API. arXiv's
existing logic moved into lib/providers/arxiv.ts unchanged — same
requests, same response shapes. /api/stats will 500 until the next
commit registers a pubmed provider for the 5 medical categories the
registry already lists; verified separately before wiring it in.
EOF
)"
```

---

## Task 3: PubMed provider (standalone — not wired into the app yet)

**Files:**
- Create: `lib/xmlEntities.ts`
- Create: `lib/providers/pubmed.ts`

**Interfaces:**
- Produces: `decodeXmlEntities(input: string): string`; `pubmedProvider: Provider` (same shape as `arxivProvider` from Task 2).
- Consumes: `getCategory` from `lib/categories.ts` (Task 1); `Paper`, `FeedResult`, `Provider` from `lib/providers/types.ts` (Task 2).

This task is verified standalone against the real NCBI API (no test framework exists; this mirrors how the arXiv Atom API's response shape was verified live while building the date picker) — it isn't imported by any route until Task 4, so it can't regress anything yet.

- [ ] **Step 1: XML entity decoder**

Write `lib/xmlEntities.ts`:

```typescript
// PubMed's efetch XML uses numeric character references (e.g. `&#x207a;` for
// "⁺") for special characters. fast-xml-parser only decodes the five named
// XML entities (&amp; &lt; &gt; &quot; &apos;), not numeric ones — verified
// directly: parsing '<x>&#x207a;</x>' returns the literal string unchanged.
// This fills that gap. Not needed for arXiv's Atom/RSS feeds.
export function decodeXmlEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
```

- [ ] **Step 2: PubMed provider**

Write `lib/providers/pubmed.ts`:

```typescript
import { XMLParser } from 'fast-xml-parser';
import { getCategory } from '@/lib/categories';
import { decodeXmlEntities } from '@/lib/xmlEntities';
import type { Paper, FeedResult, Provider } from './types';

// Same retry/timeout shape as lib/arxivFetch.ts (bounded attempt timeout +
// a couple of backoff retries), but NCBI's failure modes are independent
// of arXiv's, so this is its own small copy rather than a shared helper.
const RETRY_DELAYS_MS = [1000, 3000];
const ATTEMPT_TIMEOUT_MS = 25000;
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

async function fetchEutils(url: string, retries: number = RETRY_DELAYS_MS.length): Promise<string> {
  const delays = RETRY_DELAYS_MS.slice(0, retries);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`PubMed E-utilities returned ${response.status}`);
      }
      return await response.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < delays.length) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  throw lastError;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function toSlashDate(dateStr: string): string {
  return dateStr.replace(/-/g, '/');
}

interface EsearchResponse {
  esearchresult?: { count?: string; idlist?: string[] };
}

interface PubmedAuthor {
  LastName?: string;
  ForeName?: string;
  CollectiveName?: string;
}

interface PubmedArticleXml {
  MedlineCitation: {
    PMID: number | string | { '#text': number | string };
    Article: {
      ArticleTitle: string | { '#text': string };
      Abstract?: { AbstractText?: (string | { '#text': string })[] };
      AuthorList?: { Author?: PubmedAuthor[] };
    };
  };
}

function textOf(value: string | { '#text': string | number } | number | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return String(value['#text'] ?? '');
}

async function search(query: string, dateStr: string, start: number, maxResults: number, retries?: number) {
  const slash = toSlashDate(dateStr);
  const url =
    `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}` +
    `&datetype=pdat&mindate=${slash}&maxdate=${slash}&sort=pub_date` +
    `&retstart=${start}&retmax=${maxResults}&retmode=json`;

  const body = await fetchEutils(url, retries);
  const parsed: EsearchResponse = JSON.parse(body);
  const total = parseInt(parsed.esearchresult?.count ?? '0', 10) || 0;
  const idlist = parsed.esearchresult?.idlist ?? [];
  return { total, idlist };
}

async function fetchArticles(ids: string[], retries?: number): Promise<Map<string, PubmedArticleXml>> {
  if (ids.length === 0) return new Map();

  const url = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=abstract&retmode=xml`;
  let xml = await fetchEutils(url, retries);
  // Strip inline formatting tags before parsing — see Global Constraints
  // for why (otherwise fast-xml-parser turns a plain-text field into a
  // nested object and scrambles word order when reassembled).
  xml = xml.replace(/<\/?(i|b|sup|sub|u)>/g, '');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['PubmedArticle', 'Author', 'AbstractText'].includes(name),
  });

  const result = parser.parse(xml);
  const articles: PubmedArticleXml[] = result?.PubmedArticleSet?.PubmedArticle ?? [];

  const byId = new Map<string, PubmedArticleXml>();
  for (const article of articles) {
    const pmid = textOf(article.MedlineCitation.PMID);
    if (pmid) byId.set(pmid, article);
  }
  return byId;
}

function toPaper(pmid: string, article: PubmedArticleXml, index: number, category: string, dateStr: string): Paper {
  const title = decodeXmlEntities(textOf(article.MedlineCitation.Article.ArticleTitle));

  const abstractSections = article.MedlineCitation.Article.Abstract?.AbstractText ?? [];
  const abstract = decodeXmlEntities(abstractSections.map((s) => textOf(s)).join(' '));

  const authorEntries = article.MedlineCitation.Article.AuthorList?.Author ?? [];
  const authors = authorEntries
    .map((a) => a.CollectiveName || [a.ForeName, a.LastName].filter(Boolean).join(' '))
    .filter(Boolean);

  const published = `${dateStr}T00:00:00Z`;

  return {
    id: pmid,
    index,
    title,
    authors,
    abstract,
    published,
    updated: published,
    categories: [category],
    absUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    source: 'pubmed',
  };
}

async function fetchFeed(
  category: string,
  date: string | null,
  start: number,
  maxResults: number,
  retries?: number
): Promise<FeedResult> {
  const query = getCategory(category)?.query;
  if (!query) throw new Error(`Unknown PubMed category: ${category}`);

  const dateStr = date ?? todayISO();
  const { total, idlist } = await search(query, dateStr, start, maxResults, retries);
  if (idlist.length === 0) return { papers: [], total };

  const articlesById = await fetchArticles(idlist, retries);
  const papers = idlist
    .map((pmid, i) => {
      const article = articlesById.get(pmid);
      return article ? toPaper(pmid, article, start + i + 1, category, dateStr) : null;
    })
    .filter((p): p is Paper => p !== null);

  return { papers, total };
}

async function fetchCount(category: string): Promise<number> {
  const query = getCategory(category)?.query;
  if (!query) return 0;
  try {
    const { total } = await search(query, todayISO(), 0, 0);
    return total;
  } catch {
    return 0;
  }
}

export const pubmedProvider: Provider = { fetchFeed, fetchCount };
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify against the real NCBI API with a throwaway script**

```bash
cd /Users/sophiali/Desktop/Claude/prism
cat > /tmp/pubmed-provider-check.mjs <<'EOF'
import { pubmedProvider } from './lib/providers/pubmed.ts';

const today = new Date().toISOString().slice(0, 10);
const { papers, total } = await pubmedProvider.fetchFeed('med.ONC', today, 0, 2);
console.log('total:', total);
console.log('papers:', papers.length);
console.log(JSON.stringify(papers[0], null, 2));

const count = await pubmedProvider.fetchCount('med.CARD');
console.log('med.CARD count:', count);
EOF
npx tsx /tmp/pubmed-provider-check.mjs
```

(`npx tsx` runs a `.mjs`-adjacent TS-importing script directly, no build step — `tsx` is pulled transiently via npx if not already installed.)

Expected:
- `total` is a positive number.
- `papers.length` is `2` (or fewer, if fewer than 2 exist today for that MeSH term).
- The printed paper has a non-empty `title` and `abstract` with **no literal `&#x...;` sequences** and no stray `<i>`/`<sup>` tags — this is the check that actually proves the entity-decoding and tag-stripping from Global Constraints work end to end, not just in isolation.
- `id` looks like a PMID (digits only), `absUrl` is `https://pubmed.ncbi.nlm.nih.gov/<id>/`, `source` is `"pubmed"`, `pdfUrl` is absent.
- `med.CARD count` is a positive number.

Clean up: `rm /tmp/pubmed-provider-check.mjs`

- [ ] **Step 5: Commit**

```bash
git add lib/xmlEntities.ts lib/providers/pubmed.ts
git commit -m "$(cat <<'EOF'
Add a standalone PubMed provider (not yet wired into the app)

Implements the same fetchFeed/fetchCount shape as the arXiv provider,
via NCBI's esearch+efetch. Handles two PubMed-specific XML quirks
fast-xml-parser doesn't: numeric character references aren't decoded
(lib/xmlEntities.ts), and inline tags inside AbstractText/ArticleTitle
turn a plain-text field into a nested object unless stripped first.
Verified directly against the live NCBI API. Registered in the
provider map next commit.
EOF
)"
```

---

## Task 4: Wire PubMed into the provider registry — medical categories go live

**Files:**
- Modify: `lib/providers/index.ts`

**Interfaces:**
- Consumes: `pubmedProvider` from `lib/providers/pubmed.ts` (Task 3).

- [ ] **Step 1: Register the PubMed provider**

Replace the full contents of `lib/providers/index.ts` with:

```typescript
import { arxivProvider } from './arxiv';
import { pubmedProvider } from './pubmed';
import type { Provider } from './types';
import type { ProviderName } from '@/lib/categories';

const PROVIDERS: Record<ProviderName, Provider> = {
  arxiv: arxivProvider,
  pubmed: pubmedProvider,
};

export function getProvider(name: ProviderName): Provider {
  return PROVIDERS[name];
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify end-to-end against the running dev server**

```bash
curl -s "http://localhost:3000/api/papers?category=med.ONC&maxResults=2&start=0" | python3 -m json.tool
```
Expected: `{"papers":[...],"total":<n>,"category":"med.ONC"}`, each paper has `"source":"pubmed"`, no `pdfUrl` key, `absUrl` pointing at `pubmed.ncbi.nlm.nih.gov`.

```bash
for c in med.ONC med.CARD med.NEURO med.ID med.IMMUNO; do
  echo -n "$c: "
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/papers?category=$c&maxResults=1"
done
```
Expected: `200` for all five.

```bash
curl -s "http://localhost:3000/api/stats" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for c in ['med.ONC','med.CARD','med.NEURO','med.ID','med.IMMUNO']:
    print(c, data['counts'].get(c))
print('grandTotal', data['grandTotal'])
"
```
Expected: a number (not `None`/missing) for each of the 5, and `/api/stats` no longer 500s (regression check for the gap Task 2 Step 5 called out).

```bash
curl -s "http://localhost:3000/api/papers?category=cs.AI&maxResults=2" | python3 -m json.tool | head -20
```
Expected: still works exactly as before (arXiv path untouched by this registration change).

- [ ] **Step 4: Commit**

```bash
git add lib/providers/index.ts
git commit -m "$(cat <<'EOF'
Register the PubMed provider — medical categories go live

/api/papers?category=med.* and /api/stats now serve real PubMed data
for all 5 medical categories. arXiv categories are unaffected.
EOF
)"
```

---

## Task 5: PaperCard — source-aware UI

**Files:**
- Modify: `components/PaperCard.tsx`

**Interfaces:**
- Consumes: `Paper` from `lib/providers/types.ts` (Task 2) — `source: 'arxiv' | 'pubmed'`, `pdfUrl?: string`.
- Produces: no new exports; `PapersClient.tsx`'s existing `import PaperCard, { type Paper } from './PaperCard'` keeps working via a re-export (Step 1).

- [ ] **Step 1: Replace the local `Paper` interface with a re-export from the shared type**

In `components/PaperCard.tsx`, replace the current inline definition (lines 5-16):

```typescript
export interface Paper {
  id: string;
  index: number;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  updated: string;
  categories: string[];
  pdfUrl: string;
  absUrl: string;
}
```

with:

```typescript
export type { Paper } from '@/lib/providers/types';
```

- [ ] **Step 2: Guard the cover-image call so a PubMed PMID is never sent as `arxivId`**

In the `fetchCover` function (currently around line 92), replace:

```typescript
        body: JSON.stringify({ title: paper.title, abstract: paper.abstract, model: COVER_MODEL, arxivId: paper.id }),
```

with:

```typescript
        body: JSON.stringify({
          title: paper.title,
          abstract: paper.abstract,
          model: COVER_MODEL,
          arxivId: paper.source === 'arxiv' ? paper.id : undefined,
        }),
```

(`/api/cover` treats `arxivId` as "fetch this real arXiv figure first" — a PubMed PMID isn't an arXiv id, so sending it would make that route attempt a doomed `arxiv.org/html/{pmid}` fetch before falling back. Passing `undefined` skips straight to the AI-generation fallback, exactly like a paper with no `arxivId` today.)

- [ ] **Step 3: Source-aware action buttons**

Replace the action-buttons block (currently around lines 250-266):

```tsx
        <a
          href={paper.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="action-btn pdf-btn"
        >
          PDF ↗
        </a>

          <a
            href={paper.absUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="action-btn"
          >
            arXiv ↗
          </a>
        </div>
```

with:

```tsx
        {paper.source === 'pubmed' ? (
          <a
            href={paper.absUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="action-btn pdf-btn"
          >
            View on PubMed ↗
          </a>
        ) : (
          <>
            <a
              href={paper.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="action-btn pdf-btn"
            >
              PDF ↗
            </a>

            <a
              href={paper.absUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="action-btn"
            >
              arXiv ↗
            </a>
          </>
        )}
        </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If TS complains about `paper.pdfUrl` possibly being `undefined` in the arXiv branch: that branch is only reached when `paper.source !== 'pubmed'`, i.e. `'arxiv'`, where `pdfUrl` is always set by `arxivProvider` — but the type itself is `pdfUrl?: string` regardless of `source`, so TS can't narrow that from the `source` check alone. Fix by asserting `paper.pdfUrl!` in that branch — safe, since Task 2's `arxivProvider` always sets it.)

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds, no new errors/warnings versus the pre-change baseline.

- [ ] **Step 6: Manual browser verification**

With `npm run dev` running:
1. Load the site, stay on an arXiv category (e.g. cs.AI) — cards still show "PDF ↗" + "arXiv ↗", unchanged.
2. Click "✦ Summarize" on an arXiv card — still works (regression check for the earlier Groq-model fix, unaffected by this change).
3. Switch to a Medical category (e.g. Oncology) — cards show a single "View on PubMed ↗" button linking to `pubmed.ncbi.nlm.nih.gov`, no PDF button.
4. Click "✦ Summarize" on a PubMed card — works (the summarize route only ever needed `title`/`abstract`, source-agnostic).
5. Let a PubMed card's cover image load (scroll it into view) — it renders something (AI-generated image or the black fallback SVG), not a broken image icon, confirming the `arxivId: undefined` guard didn't break the request.

- [ ] **Step 7: Commit**

```bash
git add components/PaperCard.tsx
git commit -m "$(cat <<'EOF'
Make PaperCard source-aware for PubMed papers

PubMed papers get a single "View on PubMed" link instead of the
PDF+arXiv button pair (no free PDF to link to), and no longer send
their PMID to /api/cover as if it were an arXiv id. Paper's shape now
comes from lib/providers/types.ts instead of a local duplicate.
EOF
)"
```

---

## Task 6: Date-picker sweep — per-provider pacing

**Files:**
- Modify: `components/PapersClient.tsx`

**Interfaces:**
- Consumes: `CATEGORIES`, `SWEEP_SPACING_MS` from `lib/categories.ts` (Task 1).

Today, the date-picker's per-category count sweep is one loop over all categories at a single fixed 3500ms spacing (tuned for arXiv). With 5 PubMed categories added, this task splits it into one loop per provider, each paced by that provider's own spacing — so the medical sweep finishes in ~2s instead of being serialized behind arXiv's ~84s sweep.

- [ ] **Step 1: Add the import**

Add to the existing import block in `components/PapersClient.tsx` (alongside the `categoryLabels` import from Task 1):

```typescript
import { CATEGORIES, SWEEP_SPACING_MS } from '@/lib/categories';
```

- [ ] **Step 2: Replace the single sweep loop with a per-provider version**

Replace the date-sweep `useEffect` (the one starting `useEffect(() => { if (date === null) return; ...`, currently around lines 167-210):

```typescript
  useEffect(() => {
    if (date === null) return;

    let cancelled = false;
    setDateCounts({});
    setDateStatsLoading(true);

    // arXiv rate-limits to ~1 request every 3s; firing all 24 categories at
    // once gets every one a 429 (confirmed while building this). So these
    // run one at a time, spaced out — a full sweep takes ~1.5-4+ minutes.
    // Runs independently of category switches: changing category mid-sweep
    // doesn't restart it, since fetchPapers fills in that one directly.
    const REQUEST_SPACING_MS = 3500;
    const allCategories = Object.keys(CATEGORY_NAMES);

    (async () => {
      for (const cat of allCategories) {
        if (cancelled) return;

        try {
          const res = await fetch(
            `/api/papers?category=${encodeURIComponent(cat)}&maxResults=1&start=0&date=${encodeURIComponent(date)}&noRetry=1`
          );
          if (res.ok) {
            const data = await res.json();
            if (!cancelled && typeof data.total === 'number') {
              setDateCounts((prev) => ({ ...prev, [cat]: data.total }));
            }
          }
        } catch {
          // Leave this category unset on failure — its chip just stays "—".
        }

        if (!cancelled) {
          await new Promise((resolve) => setTimeout(resolve, REQUEST_SPACING_MS));
        }
      }
      if (!cancelled) setDateStatsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [date]);
```

with:

```typescript
  useEffect(() => {
    if (date === null) return;

    let cancelled = false;
    setDateCounts({});
    setDateStatsLoading(true);

    // Each provider has its own rate limit (arXiv ~1 req/3s, PubMed ~3
    // req/sec) — see SWEEP_SPACING_MS. One sweep loop per provider, run
    // concurrently, so a slow arXiv sweep doesn't hold up the medical one.
    // Runs independently of category switches: changing category mid-sweep
    // doesn't restart it, since fetchPapers fills in that one directly.
    const byProvider = new Map<string, string[]>();
    for (const cat of CATEGORIES) {
      if (!byProvider.has(cat.provider)) byProvider.set(cat.provider, []);
      byProvider.get(cat.provider)!.push(cat.id);
    }

    const sweepOne = async (cats: string[], spacingMs: number) => {
      for (const cat of cats) {
        if (cancelled) return;

        try {
          const res = await fetch(
            `/api/papers?category=${encodeURIComponent(cat)}&maxResults=1&start=0&date=${encodeURIComponent(date)}&noRetry=1`
          );
          if (res.ok) {
            const data = await res.json();
            if (!cancelled && typeof data.total === 'number') {
              setDateCounts((prev) => ({ ...prev, [cat]: data.total }));
            }
          }
        } catch {
          // Leave this category unset on failure — its chip just stays "—".
        }

        if (!cancelled) {
          await new Promise((resolve) => setTimeout(resolve, spacingMs));
        }
      }
    };

    (async () => {
      await Promise.all(
        Array.from(byProvider.entries()).map(([provider, cats]) =>
          sweepOne(cats, SWEEP_SPACING_MS[provider as keyof typeof SWEEP_SPACING_MS])
        )
      );
      if (!cancelled) setDateStatsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [date]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Manual browser verification**

With `npm run dev` running:
1. Pick a past date via the date picker — chip counts across **all** groups (AI & ML, Physics, Biology, Medical, Math, Finance) start filling in.
2. The 5 Medical chips (under the "Medical" group) finish filling in within a few seconds — much faster than the arXiv chips, which continue trickling in over the next couple of minutes, exactly as before.
3. Switch category mid-sweep — the sweep keeps running in the background (unchanged behavior), and the newly-selected category's own count still comes from its direct `fetchPapers` call.
4. Clear the date ("Today") — chips revert to today's counts.

- [ ] **Step 6: Commit**

```bash
git add components/PapersClient.tsx
git commit -m "$(cat <<'EOF'
Pace the date-picker's category sweep per provider

The 5 medical categories no longer wait behind arXiv's ~84s sweep at
its 3500ms/category pacing — PubMed's own sweep runs concurrently at
400ms/category and finishes in a couple of seconds.
EOF
)"
```

---

## Task 7: Full regression pass

**Files:** none (verification-only task)

**Interfaces:** none new.

- [ ] **Step 1: Confirm the dev server is running**

```bash
lsof -nP -i :3000 | grep LISTEN || (cd /Users/sophiali/Desktop/Claude/prism && npm run dev &)
```

- [ ] **Step 2: Full type-check and build, one more time, on the final state of all 6 tasks**

```bash
npx tsc --noEmit
npm run build
```
Expected: both clean.

- [ ] **Step 3: Browser walkthrough — everything in one pass**

1. Load `http://localhost:3000` — category strip shows AI & ML, Physics, Biology, **Medical**, Math, Finance in that order; today's arXiv feed loads as before.
2. Click through 2-3 arXiv categories — unchanged behavior, chip counts populate.
3. Click a Medical category (e.g. Oncology) — papers load, each card shows a single "View on PubMed ↗" button.
4. Click "✦ Summarize" on both an arXiv card and a PubMed card — both produce a real summary (not "Could not generate summary").
5. Scroll a PubMed card's cover image into view — an image (or the black fallback) renders, no broken-image icon.
6. Pick a past date — both arXiv and Medical chip counts fill in (Medical noticeably faster); papers list for whichever category is selected updates to that date; "Load more" works if `total` exceeds the page size for a medical category.
7. Clear the date — reverts to today's feed/counts for whichever category is selected.
8. Refresh button and "Try Again" (if you can trigger an error state) still work for both arXiv and Medical categories.

- [ ] **Step 4: No commit** — this task only verifies Tasks 1-6, which already committed their own changes.

- [ ] **Step 5: Report the out-of-scope finding**

Remind the user (in chat, not a commit) that `app/api/cover/route.ts:133` still hardcodes the deprecated `llama-3.1-8b-instant` Groq model — same bug already fixed in `summarize/route.ts`, silently degrading cover-image prompts to the raw title instead of erroring. Not touched by this plan; offer to fix it as a separate follow-up if wanted.
