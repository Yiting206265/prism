# Date Picker for Browsing Past Papers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a date picker next to the Refresh button so users can browse papers submitted on a specific past date, instead of only ever seeing today's arXiv RSS feed (which is empty on weekends/holidays).

**Architecture:** `app/api/papers/route.ts` grows a second code path: when a `date` query param is present, it queries arXiv's `export.arxiv.org/api/query` Atom search API (filtered to that day, sorted by submission date) instead of the `rss.arxiv.org` RSS feed, parsing into the exact same `Paper` shape the frontend already renders. `PapersClient.tsx` grows a `date` state, a date `<input>` control, and passes `date` through to the fetch when set — with a guard so date-scoped fetches never overwrite the "today" category counts used by the hero/chips.

**Tech Stack:** Next.js 14 App Router API routes, `fast-xml-parser` (already a dependency), React state in an existing client component. No test framework exists in this repo (confirmed: no jest/vitest config, no `*.test.*` files, no `test` script in `package.json`) — verification is `npx tsc --noEmit`, `npm run build`, and manual browser checks, consistent with how the rest of the app is verified.

## Global Constraints

- Date param format: `YYYY-MM-DD` (native `<input type="date">` produces this).
- arXiv's `submittedDate` filter needs `YYYYMMDDTTTT` (no dashes) — convert before building the query.
- Allowed date range: today − 90 days ≤ date ≤ today (spec: "reasonable recent window").
- Category chip counts and the hero "new today" stat must always reflect **today's** RSS counts, never a past date's counts (spec decision — avoids firing 24 parallel arXiv queries per date change).
- Query endpoint is `https://export.arxiv.org/api/query` (verified directly reachable over https with 200; the bare `http://export.arxiv.org` host 301-redirects, so use https directly to skip that hop).
- Verified Atom response shape via a live request against `cat:cs.AI`:
  - Root: `feed` with `opensearch:totalResults` (string/number of total matches).
  - `feed.entry` — array when >1 result, single object when exactly 1, absent when 0. Needs `isArray` config for `entry`, plus `author` and `category` (same multi/single/absent ambiguity).
  - `entry.id`: `"http://arxiv.org/abs/2608.00888v1"` — arXiv id is everything after `http://arxiv.org/abs/` (keeps the `vN` suffix, matching how the RSS branch keeps `vN` from its guid).
  - `entry.title`: plain string (may contain LaTeX, same as RSS titles).
  - `entry.summary`: abstract text (may contain LaTeX, same as RSS description minus the "Announce Type/Abstract:" prefix RSS has — no prefix-stripping needed here).
  - `entry.published`, `entry.updated`: ISO 8601 strings, e.g. `"2026-08-01T22:36:35Z"` — directly usable, `PaperCard`'s `formatDate` already does `new Date(dateStr)`.
  - `entry.author`: array (or single object) of `{ name: string }`.
  - `entry.category`: array (or single object) of `{ '@_term': string, '@_scheme': string }` — same attribute shape the RSS parser already handles (`ignoreAttributes: false, attributeNamePrefix: '@_'`).
  - A real date-filtered query (`submittedDate:[...]`) took ~6.5s to respond in testing — noticeably slower than the RSS feed (~70ms) or an unfiltered query. No explicit fetch timeout is added (the existing RSS route doesn't set one either — stay consistent), but this is worth knowing when manually verifying: the date-picker path will feel slower than switching categories.

---

## Task 1: Date-scoped papers API

**Files:**
- Modify: `app/api/papers/route.ts`

**Interfaces:**
- Produces: `GET /api/papers?category={cat}&maxResults={n}&start={n}&date={YYYY-MM-DD}` (new optional `date` param). Response shape unchanged: `{ papers: Paper[], total: number, category: string }` (RSS path) or `{ papers: Paper[], total: number, category: string, date: string }` (date path) — `papers` items match the existing `Paper` interface in `components/PaperCard.tsx:6-15` exactly, so the frontend needs no changes to render them.
- Consumes: `cleanLatexText` from `@/lib/cleanText` (already imported in this file).

- [ ] **Step 1: Add date validation + the date-query branch**

Replace the full contents of `app/api/papers/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { cleanLatexText } from '@/lib/cleanText';

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_BACK = 90;

function isValidDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;

  const picked = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(picked.getTime())) return false;

  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const earliest = new Date(todayUTC);
  earliest.setUTCDate(earliest.getUTCDate() - MAX_DAYS_BACK);

  return picked >= earliest && picked <= todayUTC;
}

async function fetchByDate(category: string, dateStr: string, start: number, maxResults: number) {
  const yyyymmdd = dateStr.replace(/-/g, '');
  const searchQuery = `cat:${category}+AND+submittedDate:[${yyyymmdd}0000+TO+${yyyymmdd}2359]`;
  const url =
    `https://export.arxiv.org/api/query?search_query=${searchQuery}` +
    `&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${maxResults}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`arXiv query API returned ${response.status}`);
  }

  const xml = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['entry', 'author', 'category'].includes(name),
  });

  const result = parser.parse(xml);
  const entries: AtomEntry[] = result?.feed?.entry ?? [];
  const total = parseInt(result?.feed?.['opensearch:totalResults'] ?? '0', 10) || 0;

  const papers = entries.map((entry, index) => {
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
    };
  });

  return { papers, total };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'cs.AI';
  const maxResults = Math.min(parseInt(searchParams.get('maxResults') || '20', 10), 50);
  const start = Math.max(parseInt(searchParams.get('start') || '0', 10), 0);
  const date = searchParams.get('date');

  if (!/^[a-zA-Z0-9.\-]+$/.test(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  if (date !== null && !isValidDate(date)) {
    return NextResponse.json(
      { error: `Invalid date. Must be YYYY-MM-DD within the last ${MAX_DAYS_BACK} days.` },
      { status: 400 }
    );
  }

  try {
    if (date !== null) {
      const { papers, total } = await fetchByDate(category, date, start, maxResults);
      return NextResponse.json({ papers, total, category, date });
    }

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

    const allPapers = items.map((item, index) => {
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
      const abstract = cleanLatexText(
        abstractMatch ? abstractMatch[1] : rawDesc
      );

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
      };
    });

    const papers = allPapers.slice(start, start + maxResults);

    return NextResponse.json({ papers, total: allPapers.length, category });
  } catch (error) {
    console.error('[papers] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch papers from arXiv. Please try again.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify both branches against the real API**

Run (today path, unchanged):
```bash
curl -s "http://localhost:3000/api/papers?category=cs.AI&maxResults=3&start=0" | head -c 300
```
Expected: `{"papers":[...],"total":<n>,"category":"cs.AI"}` (dev server must be running — see Task 3 for how to confirm/start it).

Run (date path, a known-populated weekday, e.g. 2026-08-06):
```bash
curl -s "http://localhost:3000/api/papers?category=cs.AI&maxResults=3&start=0&date=2026-08-06" | head -c 500
```
Expected: `{"papers":[{...}],"total":<n>,"category":"cs.AI","date":"2026-08-06"}` with non-empty `papers`.

Run (invalid date rejected):
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/papers?category=cs.AI&date=2020-01-01"
```
Expected: `400` (outside the 90-day window).

- [ ] **Step 4: Commit**

```bash
git add app/api/papers/route.ts
git commit -m "$(cat <<'EOF'
Add date-scoped paper lookup via arXiv's query API

Lets /api/papers return papers submitted on a specific past date
(via export.arxiv.org's search API) instead of only today's RSS feed.
EOF
)"
```

---

## Task 2: Date picker UI

**Files:**
- Modify: `components/PapersClient.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `GET /api/papers?...&date=YYYY-MM-DD` from Task 1, response `{ papers, total, category, date? }`.
- Produces: no new exports — this is a leaf UI change within `PapersClient`.

- [ ] **Step 1: Add `date` state and thread it through `fetchPapers`**

In `components/PapersClient.tsx`, update the state block (currently lines 63-75) to add a `date` field, right after the existing `offset` state:

```typescript
  const [category, setCategory] = useState('cs.AI');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [offset, setOffset]         = useState(0);
  const [date, setDate]             = useState<string | null>(null);
```

Then replace the `fetchPapers` callback (currently lines 77-108) with a version that accepts the date and only syncs `counts` when there is none:

```typescript
  const fetchPapers = useCallback(async (cat: string, start = 0, append = false, dateOverride: string | null = null) => {
    if (append) setIsLoadingMore(true);
    else {
      setIsLoading(true);
      setError(null);
      setPapers([]);
    }

    try {
      const dateParam = dateOverride ? `&date=${encodeURIComponent(dateOverride)}` : '';
      const res = await fetch(
        `/api/papers?category=${encodeURIComponent(cat)}&maxResults=${PAGE_SIZE}&start=${start}${dateParam}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const newPapers: Paper[] = data.papers ?? [];
      setPapers((prev) => (append ? [...prev, ...newPapers] : newPapers));
      setTotal(data.total ?? 0);
      setOffset(start + newPapers.length);
      // Only sync the "new today" chip/hero counts from today's feed —
      // a date-scoped fetch must never overwrite that state.
      if (!dateOverride && typeof data.total === 'number') {
        setCounts((prev) => ({ ...prev, [cat]: data.total }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load papers.');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);
```

Update the effect that refetches on category change (currently lines 135-138) to also pass the current `date`, and re-run when `date` changes too:

```typescript
  useEffect(() => {
    setOffset(0);
    fetchPapers(category, 0, false, date);
  }, [category, date, fetchPapers]);
```

Update `handleCategoryChange` (currently lines 140-147) to pass `date` through on same-category refresh:

```typescript
  const handleCategoryChange = (cat: string) => {
    if (cat === category) {
      setOffset(0);
      fetchPapers(cat, 0, false, date);
    } else {
      setCategory(cat);
    }
  };
```

Update `handleLoadMore` (currently lines 149-151) to pass `date` through:

```typescript
  const handleLoadMore = () => {
    fetchPapers(category, offset, true, date);
  };
```

Update the Refresh button's `onClick` (currently line 189, `onClick={() => fetchPapers(category)}`) to pass `date`:

```typescript
              onClick={() => fetchPapers(category, 0, false, date)}
```

And the error state's "Try Again" button `onClick` (currently line 203, `onClick={() => fetchPapers(category)}`):

```typescript
            <button className="retry-btn" onClick={() => fetchPapers(category, 0, false, date)}>
```

- [ ] **Step 2: Add the date `<input>` next to Refresh, and derive the min/max bounds**

Add a helper near the top of the file (after the `CATEGORY_NAMES` map, before `SkeletonList`):

```typescript
const MAX_DAYS_BACK = 90;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function minDateISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - MAX_DAYS_BACK);
  return d.toISOString().slice(0, 10);
}
```

In the JSX, update `.papers-header-actions` (currently lines 186-195) to add the date input before the Refresh button, plus a clear affordance shown only when a date is picked:

```tsx
          <div className="papers-header-actions">
            <input
              type="date"
              className="date-picker"
              value={date ?? ''}
              min={minDateISO()}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value || null)}
              aria-label="Browse papers from a specific date"
            />
            {date && (
              <button className="date-clear-btn" onClick={() => setDate(null)}>
                Today
              </button>
            )}
            <button
              className="refresh-btn"
              onClick={() => fetchPapers(category, 0, false, date)}
              disabled={isLoading}
            >
              <span className={`refresh-icon${isLoading ? ' spinning' : ''}`}>↻</span>
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
```

- [ ] **Step 3: Switch the header badge and empty-state copy based on `date`**

Replace the badge block (currently lines 179-183):

```tsx
            {!isLoading && papers.length > 0 && (
              <span className="papers-count-badge">
                {date
                  ? `${papers.length} of ${total.toLocaleString()} papers on ${date}`
                  : `${papers.length} of ${total.toLocaleString()} new today`}
              </span>
            )}
```

Replace the empty-state block (currently lines 209-213):

```tsx
        {!isLoading && !error && papers.length === 0 && (
          <div className="empty-state">
            <p className="empty-label">
              {date ? 'No papers found for this date.' : 'No papers found for this category.'}
            </p>
          </div>
        )}
```

- [ ] **Step 4: Style the new controls**

In `app/globals.css`, right after the existing `.refresh-icon.spinning { animation: spin 0.8s linear infinite; }` rule (around line 515), add:

```css
.date-picker {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.date-picker:hover { border-color: var(--border-strong); color: var(--text-primary); }

.date-clear-btn {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.date-clear-btn:hover { border-color: var(--border-strong); color: var(--text-primary); }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build succeeds with no errors (warnings about unrelated existing code are fine — check the diff of any new warnings against the pre-change baseline if unsure).

- [ ] **Step 7: Manual browser verification**

With `npm run dev` running (see Task 3 for confirming a dev server is up):
1. Load `http://localhost:3000` — confirm the date input and Refresh button both appear in the papers header, and the list still shows today's feed unchanged.
2. Pick a past weekday date (e.g. 2026-08-06) — confirm the badge changes to "X of Y papers on 2026-08-06", the list repopulates, and "Load more" works if `total` > 20.
3. Pick a past weekend date — confirm papers still show (this is the whole point of the feature).
4. Switch category while a date is selected — confirm the date stays selected and the list refetches for the new category at that date.
5. Click "Today" to clear the date — confirm the list reverts to today's RSS feed and the category chip count for the current category is still correct (not clobbered by the date-scoped fetch's `total`).

- [ ] **Step 8: Commit**

```bash
git add components/PapersClient.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Add date picker for browsing past papers

Lets users pick a date (last 90 days) to see papers submitted that
day via arXiv's query API, instead of only today's RSS feed. Category
chip counts stay pinned to today's counts regardless of the picked
date, per design.
EOF
)"
```

---

## Task 3: End-to-end smoke check against a running dev server

**Files:** none (verification-only task)

**Interfaces:** none new.

- [ ] **Step 1: Confirm (or start) the dev server**

```bash
lsof -nP -i :3000 | grep LISTEN || (cd /Users/sophiali/Desktop/Claude/prism && npm run dev &)
```

Expected: a `next-server` process listening on `:3000`. If one wasn't already running, wait a few seconds for "Ready" in its output before proceeding.

- [ ] **Step 2: Re-run the curl checks from Task 1 Step 3 against the live server**

(Already covered in Task 1 Step 3 — re-run them here if the dev server wasn't up during Task 1.)

- [ ] **Step 3: Re-run the manual browser walkthrough from Task 2 Step 7**

(Already covered in Task 2 Step 7 — this step exists as a checkpoint in case Task 2 was implemented without a live server available at the time.)

- [ ] **Step 4: No commit** — this task only verifies Tasks 1 and 2, which already committed their own changes.
