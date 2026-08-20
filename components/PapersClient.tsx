'use client';

import { useState, useEffect, useCallback } from 'react';
import Hero from './Hero';
import CategorySelector from './CategorySelector';
import PaperCard, { type Paper } from './PaperCard';
import Lightbox from './Lightbox';
import { categoryLabels, CATEGORIES, SWEEP_SPACING_MS, getCategory } from '@/lib/categories';

const CATEGORY_NAMES: Record<string, string> = categoryLabels();

const MAX_DAYS_BACK = 90;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function minDateISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - MAX_DAYS_BACK);
  return d.toISOString().slice(0, 10);
}

function SkeletonList() {
  return (
    <div className="skeleton-list">
      <div className="skeleton-card-featured">
        <div className="skeleton-block sk-title" style={{ width: '85%' }} />
        <div className="skeleton-block sk-title-2" style={{ width: '60%' }} />
        <div className="skeleton-block sk-meta" style={{ marginTop: '0.6rem' }} />
        <div className="skeleton-block sk-line" style={{ marginTop: '0.9rem' }} />
        <div className="skeleton-block sk-line-2" />
      </div>
      <div className="skeleton-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-card-grid">
            <div className="skeleton-block sk-title" style={{ animationDelay: `${i * 60}ms` }} />
            <div className="skeleton-block sk-meta" style={{ animationDelay: `${i * 60 + 80}ms` }} />
            <div className="skeleton-block sk-line" style={{ animationDelay: `${i * 60 + 120}ms` }} />
            <div className="skeleton-block sk-line-2" style={{ animationDelay: `${i * 60 + 160}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const PAGE_SIZE = 20;

export default function PapersClient() {
  const [category, setCategory] = useState('cs.AI');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [offset, setOffset]         = useState(0);
  const [date, setDate]             = useState<string | null>(null);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [categoriesLive, setCategoriesLive] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Counts for the currently-picked date, across all 24 categories — filled
  // in one category at a time (see the effect below) since arXiv rate-limits
  // to ~1 request/3s and firing all 24 in parallel gets every one a 429.
  const [dateCounts, setDateCounts] = useState<Record<string, number>>({});
  const [dateStatsLoading, setDateStatsLoading] = useState(false);

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
      if (typeof data.total === 'number') {
        if (dateOverride) {
          // Reuse this total for the date-scoped chip sweep below — saves a
          // redundant arXiv request for whichever category is selected.
          setDateCounts((prev) => ({ ...prev, [cat]: data.total }));
        } else {
          // Keep hero/chip counts in sync with today's feed only — a
          // date-scoped fetch must never overwrite the "new today" counts.
          setCounts((prev) => ({ ...prev, [cat]: data.total }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load papers.');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error('stats failed');
        const data = await res.json();
        if (cancelled) return;
        setCounts(data.counts ?? {});
        setCategoriesLive(data.categoriesLive ?? 0);
        setAsOf(data.asOf ?? null);
      } catch {
        if (!cancelled) {
          setCategoriesLive(Object.keys(CATEGORY_NAMES).length);
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setOffset(0);
    fetchPapers(category, 0, false, date);
  }, [category, date, fetchPapers]);

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

  const handleCategoryChange = (cat: string) => {
    if (cat === category) {
      setOffset(0);
      fetchPapers(cat, 0, false, date);
    } else {
      setCategory(cat);
    }
  };

  const handleLoadMore = () => {
    fetchPapers(category, offset, true, date);
  };

  const categoryLabel = CATEGORY_NAMES[category] ?? category;
  const sourceLabel = getCategory(category)?.provider === 'pubmed' ? 'PubMed' : 'arXiv';
  const newToday = counts[category] ?? total;
  // When browsing a past date, every hero stat and chip count comes from the
  // date-scoped stats fetch (all 24 categories) instead of today's RSS data.
  const heroStatValue = date ? (dateCounts[category] ?? total) : newToday;
  const heroStatLabel = date ? 'Papers found' : 'New today';
  const displayCounts = date ? dateCounts : counts;
  // Climbs progressively as the per-category sweep (above) fills in — an
  // undercount until the sweep finishes, by design.
  const displayCategoriesLive = date
    ? Object.values(dateCounts).filter((c) => c > 0).length
    : (categoriesLive || Object.keys(counts).length);
  const displayStatsLoading = date
    ? dateStatsLoading && Object.keys(dateCounts).length === 0
    : statsLoading && !(category in counts) && total === 0;

  return (
    <>
      <Hero
        categoryCode={category}
        categoryLabel={categoryLabel}
        sourceLabel={sourceLabel}
        newToday={heroStatValue}
        newTodayLabel={heroStatLabel}
        showing={papers.length}
        categoriesLive={displayCategoriesLive}
        categoriesLiveLabel="Categories live"
        statsLoading={displayStatsLoading}
        asOf={asOf}
      />

      <CategorySelector
        selected={category}
        onChange={handleCategoryChange}
        counts={displayCounts}
        countsLoading={date ? dateStatsLoading : statsLoading}
        date={date}
      />

      <div className="papers-section">
        <div className="papers-header">
          <div className="papers-title">
            <span className="papers-category-name">{categoryLabel}</span>
            {!isLoading && papers.length > 0 && (
              <span className="papers-count-badge">
                {date
                  ? `${papers.length} of ${total.toLocaleString()} papers on ${date}`
                  : `${papers.length} of ${total.toLocaleString()} new today`}
              </span>
            )}
          </div>

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
        </div>

        {isLoading && <SkeletonList />}

        {!isLoading && error && (
          <div className="error-state">
            <p className="error-text">{error}</p>
            <button className="retry-btn" onClick={() => fetchPapers(category, 0, false, date)}>
              Try Again
            </button>
          </div>
        )}

        {!isLoading && !error && papers.length === 0 && (
          <div className="empty-state">
            <p className="empty-label">
              {date ? 'No papers found for this date.' : 'No papers found for this category.'}
            </p>
          </div>
        )}

        {!isLoading && !error && papers.length > 0 && (
          <div>
            <PaperCard
              key={papers[0].id}
              paper={papers[0]}
              index={1}
              variant="featured"
              onImageClick={setLightboxSrc}
            />

            <div className="papers-grid">
              {papers.slice(1).map((paper, i) => (
                <PaperCard
                  key={paper.id}
                  paper={paper}
                  index={i + 2}
                  variant="grid"
                  onImageClick={setLightboxSrc}
                />
              ))}
            </div>

            {offset < total && (
              <div className="load-more-wrap">
                <button
                  className="load-more-btn"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore
                    ? 'Loading…'
                    : `Load more  ·  ${offset.toLocaleString()} of ${total.toLocaleString()}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  );
}
