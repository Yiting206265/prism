'use client';

import { useState, useEffect, useCallback } from 'react';
import CategorySelector from './CategorySelector';
import PaperCard, { type Paper } from './PaperCard';

const CATEGORY_NAMES: Record<string, string> = {
  'cs.AI':   'Artificial Intelligence',
  'cs.LG':   'Machine Learning',
  'cs.CV':   'Computer Vision',
  'cs.CL':   'Computation & Language',
  'cs.RO':   'Robotics',
  'cs.NE':   'Neural & Evolutionary Computing',
  'cs.IR':   'Information Retrieval',
  'stat.ML': 'Statistics — Machine Learning',
  'quant-ph':          'Quantum Physics',
  'cond-mat.mes-hall': 'Condensed Matter',
  'hep-th':            'High Energy Theory',
  'astro-ph.GA':       'Astrophysics',
  'physics.optics':    'Optics',
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

function SkeletonList() {
  return (
    <div className="skeleton-list">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-block sk-title"  style={{ animationDelay: `${i * 60}ms` }} />
          <div className="skeleton-block sk-title-2" style={{ animationDelay: `${i * 60 + 40}ms` }} />
          <div className="skeleton-block sk-meta"   style={{ animationDelay: `${i * 60 + 80}ms` }} />
          <div className="skeleton-block sk-line"   style={{ animationDelay: `${i * 60 + 120}ms` }} />
          <div className="skeleton-block sk-line-2" style={{ animationDelay: `${i * 60 + 160}ms` }} />
        </div>
      ))}
    </div>
  );
}

const PAGE_SIZE = 20;

export default function PapersClient() {
  const [category, setCategory]     = useState('cs.AI');
  const [papers, setPapers]         = useState<Paper[]>([]);
  const [total, setTotal]           = useState(0);
  const [isLoading, setIsLoading]   = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [offset, setOffset]         = useState(0);

  const fetchPapers = useCallback(async (cat: string, start = 0, append = false) => {
    if (append) setIsLoadingMore(true);
    else { setIsLoading(true); setError(null); setPapers([]); }

    try {
      const res = await fetch(`/api/papers?category=${encodeURIComponent(cat)}&maxResults=${PAGE_SIZE}&start=${start}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const newPapers: Paper[] = data.papers ?? [];
      setPapers((prev) => append ? [...prev, ...newPapers] : newPapers);
      setTotal(data.total ?? 0);
      setOffset(start + newPapers.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load papers.');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setOffset(0);
    fetchPapers(category, 0, false);
  }, [category, fetchPapers]);

  const handleCategoryChange = (cat: string) => {
    if (cat === category) {
      setOffset(0);
      fetchPapers(cat, 0, false);
    } else {
      setCategory(cat);
    }
  };

  const handleLoadMore = () => {
    fetchPapers(category, offset, true);
  };

  const categoryLabel = CATEGORY_NAMES[category] ?? category;

  return (
    <>
      <CategorySelector selected={category} onChange={handleCategoryChange} />

      <div className="papers-section">
        {/* Section header */}
        <div className="papers-header">
          <div className="papers-title">
            <span className="papers-category-name">{categoryLabel}</span>
            {!isLoading && papers.length > 0 && (
              <span className="papers-count-badge">
                {papers.length} of {total.toLocaleString()} results
              </span>
            )}
          </div>

          <div className="papers-header-actions">
            <button
              className="refresh-btn"
              onClick={() => fetchPapers(category)}
              disabled={isLoading}
            >
              <span className={`refresh-icon${isLoading ? ' spinning' : ''}`}>↻</span>
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* States */}
        {isLoading && <SkeletonList />}

        {!isLoading && error && (
          <div className="error-state">
            <p className="error-text">{error}</p>
            <button className="retry-btn" onClick={() => fetchPapers(category)}>
              Try Again
            </button>
          </div>
        )}

        {!isLoading && !error && papers.length === 0 && (
          <div className="empty-state">
            <p className="empty-label">No papers found for this category.</p>
          </div>
        )}

        {!isLoading && !error && papers.length > 0 && (
          <div>
            {papers.map((paper, i) => (
              <PaperCard key={paper.id} paper={paper} index={i + 1} />
            ))}

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
    </>
  );
}
