'use client';

import { useEffect, useRef, useState } from 'react';
import { categoryGroups, getCategory } from '@/lib/categories';

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
  date = null,
}: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExpandedWhileSticky, setIsExpandedWhileSticky] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const selectedCategory = getCategory(selected);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const mobileQuery = window.matchMedia('(max-width: 640px)');
    let observer: IntersectionObserver;

    const observeAtHeaderEdge = () => {
      observer?.disconnect();
      const headerHeight = mobileQuery.matches ? 48 : 64;

      observer = new IntersectionObserver(
        ([entry]) => {
          const hasReachedHeader =
            !entry.isIntersecting && entry.boundingClientRect.top < headerHeight;
          setIsCollapsed(hasReachedHeader);
          if (!hasReachedHeader) setIsExpandedWhileSticky(false);
        },
        {
          rootMargin: `-${headerHeight}px 0px 0px 0px`,
          threshold: 0,
        }
      );

      observer.observe(sentinel);
    };

    observeAtHeaderEdge();
    mobileQuery.addEventListener('change', observeAtHeaderEdge);

    return () => {
      observer.disconnect();
      mobileQuery.removeEventListener('change', observeAtHeaderEdge);
    };
  }, []);

  const showFullSelector = !isCollapsed || isExpandedWhileSticky;

  const handleCategoryChange = (category: string) => {
    onChange(category);
    if (isCollapsed) setIsExpandedWhileSticky(false);
  };

  return (
    <>
      <div ref={sentinelRef} className="cat-strip-sentinel" aria-hidden="true" />
      <div
        className={`cat-strip${isCollapsed ? ' is-collapsed' : ''}${
          isExpandedWhileSticky ? ' is-expanded' : ''
        }`}
      >
        {isCollapsed && (
          <div className="cat-strip-compact">
            <div className="cat-current">
              <span className="cat-current-name">
                {selectedCategory?.name ?? selected}
              </span>
            </div>
            <button
              type="button"
              className="cat-expand-btn"
              aria-expanded={isExpandedWhileSticky}
              aria-controls="category-options"
              onClick={() => setIsExpandedWhileSticky((expanded) => !expanded)}
            >
              {isExpandedWhileSticky ? 'Close' : 'All categories'}
              <span className="cat-expand-icon" aria-hidden="true">
                {isExpandedWhileSticky ? '−' : '+'}
              </span>
            </button>
          </div>
        )}

        {showFullSelector && (
          <div id="category-options" className="cat-strip-inner">
            {GROUPS.map((group) => (
              <div key={group.label} className="cat-row">
                <span className="cat-group-lbl" aria-hidden="true">
                  {group.label}
                </span>
                <div className="cat-row-scroll" role="tablist" aria-label={`${group.label} categories`}>
                  {group.categories.map((cat) => {
                    const count = counts[cat.id];
                    const hasCount = typeof count === 'number';
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        role="tab"
                        aria-selected={selected === cat.id}
                        className={`cat-btn${selected === cat.id ? ' active' : ''}`}
                        onClick={() => handleCategoryChange(cat.id)}
                        title={
                          hasCount
                            ? date
                              ? `${cat.label} — ${count.toLocaleString()} papers on ${date}`
                              : `${cat.label} — ${count.toLocaleString()} new today`
                            : cat.label
                        }
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
