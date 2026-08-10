'use client';

import { useState, useEffect, useCallback } from 'react';
import Hero from './Hero';
import CategorySelector from './CategorySelector';
import PaperCard, { type Paper } from './PaperCard';
import Lightbox from './Lightbox';

const CATEGORY_NAMES: Record<string, string> = {
  'cs.AI': 'Artificial Intelligence',
  'cs.LG': 'Machine Learning',
  'cs.CV': 'Computer Vision',
  'cs.CL': 'Computation & Language',
  'cs.RO': 'Robotics',
  'cs.NE': 'Neural & Evolutionary Computing',
  'cs.IR': 'Information Retrieval',
  'stat.ML': 'Statistics — Machine Learning',
  'quant-ph': 'Quantum Physics',
  'cond-mat.mes-hall': 'Condensed Matter',
  'hep-th': 'High Energy Theory',
  'astro-ph.GA': 'Astrophysics',
  'physics.optics': 'Optics',
  'q-bio.NC': 'Neurons & Cognition',
  'q-bio.GN': 'Genomics',
  'q-bio.BM': 'Biomolecules',
  'q-bio.QM': 'Quantitative Methods',
  'math.ST': 'Statistics Theory',
  'math.OC': 'Optimization & Control',
  'math.CO': 'Combinatorics',
  'math.PR': 'Probability',
  'q-fin.TR': 'Trading & Microstructure',
  'q-fin.PM': 'Portfolio Management',
  'q-fin.RM': 'Risk Management',
};

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
      // Keep hero/chip counts in sync with today's feed only — a date-scoped
      // fetch must never overwrite the "new today" counts.
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
  const newToday = counts[category] ?? total;
  // When browsing a past date, the primary hero stat should reflect that
  // date's results rather than today's — but "Categories live" stays
  // pinned to today (see chip counts: re-scoping it to the picked date
  // would mean 24 more arXiv queries per date change).
  const heroStatValue = date ? total : newToday;
  const heroStatLabel = date ? 'Papers found' : 'New today';
  const categoriesLiveLabel = date ? 'Live today' : 'Categories live';
  // Only the selected chip's count is known for the picked date (it came
  // back with the papers fetch, no extra request). The other 23 categories'
  // today-counts would be misleading shown as this date's counts, so drop
  // them entirely rather than imply "0 papers on this date" — the chip UI
  // renders a neutral "—" for categories with no known count.
  const displayCounts = date ? { [category]: total } : counts;

  return (
    <>
      <Hero
        categoryCode={category}
        categoryLabel={categoryLabel}
        newToday={heroStatValue}
        newTodayLabel={heroStatLabel}
        showing={papers.length}
        categoriesLive={categoriesLive || Object.keys(counts).length}
        categoriesLiveLabel={categoriesLiveLabel}
        statsLoading={statsLoading && !(category in counts) && total === 0}
        asOf={asOf}
      />

      <CategorySelector
        selected={category}
        onChange={handleCategoryChange}
        counts={displayCounts}
        countsLoading={statsLoading}
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
