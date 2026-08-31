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
            <div className="cat-row-scroll">
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
          </div>
        ))}
      </div>
    </div>
  );
}
