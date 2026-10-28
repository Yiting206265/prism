# Date picker for browsing past papers

## Problem

Prism's paper list is powered entirely by `rss.arxiv.org/rss/{category}`,
which only lists papers announced **today**. arXiv doesn't publish on
weekends (the feed itself declares `<skipDays>Saturday, Sunday</skipDays>`),
so on those days — and on any day before a category's daily announcement has
run — the list is empty with no way to see anything else.

## Goal

Let users manually pick a past date and browse papers submitted on that date,
via a date picker next to the existing Refresh button. Today's "new today"
behavior is unchanged; the date picker is an alternate, explicit mode, not an
automatic fallback.

## Non-goals

- No automatic fallback when today's feed is empty (user decided: manual
  date picker only, replaces that idea).
- Category chip counts (`cs.AI 710`, etc.) do **not** change when a past
  date is selected — they always reflect today's counts, to avoid firing 24
  parallel arXiv queries on every date change.
- No date range beyond the last 90 days.
- No automated test suite exists in this repo today; verification is manual,
  consistent with the rest of the project.

## Data source

arXiv's query API (`export.arxiv.org/api/query`) supports searching a
category within a submission-date range, sorted by date, with `start` /
`max_results` pagination — this covers the "load more" pattern the app
already uses for today's feed. Response format is Atom (`<entry>` elements),
different from the RSS `<item>` format used today, so it needs its own
parsing branch, reusing the existing `cleanLatexText` helper and the same
`Paper` shape the frontend already consumes.

## API changes — `app/api/papers/route.ts`

Add an optional `date` query param (`YYYY-MM-DD`).

- **`date` absent** (current behavior, unchanged): fetch
  `rss.arxiv.org/rss/{category}`, parse RSS `<item>`s, return
  `{ papers, total, category }`.
- **`date` present**:
  1. Validate format (`YYYY-MM-DD`) and range (today − 90 days ≤ date ≤
     today). Reject outside that range with `400`, same style as the
     existing category-validation check.
  2. Query (arXiv's `submittedDate` range wants `YYYYMMDDTTTT`, no dashes —
     so `date` must be reformatted from `YYYY-MM-DD` to `YYYYMMDD` first):
     ```
     https://export.arxiv.org/api/query
       ?search_query=cat:{category}+AND+submittedDate:[{YYYYMMDD}0000+TO+{YYYYMMDD}2359]
       &sortBy=submittedDate&sortOrder=descending
       &start={start}&max_results={maxResults}
     ```
  3. Parse the Atom response with `fast-xml-parser` (new parsing branch —
     `entry` list, `id`/`title`/`summary`/`author`/`published`/`updated`/
     `category` fields — mapped into the same `Paper` interface fields the
     RSS branch produces: `id` from the entry's arXiv abs URL, `authors`
     from repeated `author.name`, `abstract` from `summary` run through
     `cleanLatexText`, `categories` from `category` term attributes,
     `pdfUrl`/`absUrl` derived from the id).
  4. `total` comes from `opensearch:totalResults` in the feed, giving
     accurate pagination.
  5. Return `{ papers, total, category, date }`.
  6. Same error handling shape as today: catch, log, `500` with a friendly
     message.

`app/api/stats/route.ts` is unchanged.

## Frontend changes — `components/PapersClient.tsx`

- New state: `date: string | null` (`null` = today/RSS mode, the default).
- `fetchPapers` accepts the date and appends `&date=...` to the request URL
  when set; changing the date resets `offset` to 0 like changing category
  does.
- **Guard**: the line that syncs `counts[category]` from a fetch response
  (`setCounts((prev) => ({ ...prev, [cat]: data.total }))`) must only run
  when `date` is `null`. Otherwise browsing a past date would overwrite that
  category's "new today" chip/hero count with the past date's count —
  violating the "chips always reflect today" decision.
- UI: a native `<input type="date">` placed in `.papers-header-actions`
  next to the Refresh button, styled to match it (mono font, bordered,
  uppercase-adjacent look — reusing `.refresh-btn`'s visual language rather
  than inventing a new style). `min` = today − 90 days, `max` = today. A
  small clear affordance (e.g. an "×" or "Today" text button, shown only
  when a date is selected) resets `date` to `null`.
- Header badge text:
  - `date === null`: `"{papers.length} of {total} new today"` (unchanged).
  - `date !== null`: `"{papers.length} of {total} papers on {formatted
    date}"`.
- Empty state text:
  - `date === null`: `"No papers found for this category."` (unchanged).
  - `date !== null`: `"No papers found for this date."`

## Error handling

Same pattern as the existing RSS path: network/parse failures are caught,
logged server-side, and surfaced to the client as a friendly error message
with a "Try Again" retry button (already implemented in `PapersClient`'s
error state — no new UI needed there).

## Testing / verification

No automated test framework exists in this repo. Verify manually in the
browser:

- Default load still shows today's RSS-based "new today" list, unchanged.
- Picking a past weekday date shows that date's papers with correct
  "X of Y papers on {date}" badge and working "Load more" pagination.
- Picking a past weekend date (when RSS would show 0) successfully shows
  papers via the query API.
- Switching category while a past date is selected keeps the date and
  refetches for the new category.
- Clearing the date returns to today's RSS list, and that category's chip
  count is still accurate (not clobbered by the earlier past-date fetch).
- Date input respects the 90-day min bound and today as max.
