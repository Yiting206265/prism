'use client';

import { useState } from 'react';

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

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = Math.floor(diffMs / 36e5);
  const diffD = Math.floor(diffH / 24);

  if (diffH < 1)  return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 7)  return `${diffD}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtAuthors(authors: string[], max = 3): string {
  if (!authors.length) return 'Unknown';
  if (authors.length <= max) return authors.join(' · ');
  return authors.slice(0, max).join(' · ') + ` +${authors.length - max}`;
}

type SumState = 'idle' | 'streaming' | 'done' | 'error';

export default function PaperCard({ paper, index }: { paper: Paper; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary]   = useState('');
  const [sumState, setSumState] = useState<SumState>('idle');

  const num = String(index).padStart(2, '0');
  const primaryCats = paper.categories.slice(0, 3);

  async function handleSummarize() {
    if (sumState === 'streaming' || sumState === 'done') return;

    setSumState('streaming');
    setSummary('');

    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: paper.title, abstract: paper.abstract }),
      });

      if (!res.ok) throw new Error(`${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No body reader');

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setSummary((prev) => prev + decoder.decode(value, { stream: true }));
      }

      setSumState('done');
    } catch {
      setSummary('Could not generate summary. Please try again.');
      setSumState('error');
    }
  }

  return (
    <article
      className="paper-card"
      style={{ animationDelay: `${(index - 1) * 45}ms` }}
    >
      <div className="paper-index" aria-hidden="true">
        {num}
      </div>

      <div className="paper-body">
        {/* Title */}
        <h2 className="paper-title">
          <a href={paper.absUrl} target="_blank" rel="noopener noreferrer">
            {paper.title}
          </a>
        </h2>

        {/* Meta row */}
        <div className="paper-meta">
          <span className="paper-authors">{fmtAuthors(paper.authors)}</span>

          {primaryCats.length > 0 && (
            <>
              <span className="meta-sep">·</span>
              <span className="paper-cats">
                {primaryCats.map((c) => (
                  <span key={c} className="paper-cat-tag">{c}</span>
                ))}
              </span>
            </>
          )}

          {paper.published && (
            <>
              <span className="meta-sep">·</span>
              <span className="paper-date">{formatDate(paper.published)}</span>
            </>
          )}
        </div>

        {/* Abstract */}
        <div className={`paper-abstract-wrap ${expanded ? 'expanded' : 'collapsed'}`}>
          <p className="paper-abstract">{paper.abstract}</p>
        </div>

        {/* AI Summary */}
        {(summary || sumState === 'streaming') && (
          <div className="paper-summary">
            <div className="summary-header">
              <span>✦</span>
              <span>AI Summary</span>
              {sumState === 'streaming' && (
                <span className="summary-cursor">▌</span>
              )}
            </div>
            <p className="summary-body">{summary}</p>
          </div>
        )}

        {/* Actions */}
        <div className="paper-actions">
          <button
            className="action-btn"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
          >
            {expanded ? '↑ Collapse' : '↓ Abstract'}
          </button>

          <button
            className={`action-btn ai-btn${sumState === 'done' ? ' summarized' : ''}`}
            onClick={handleSummarize}
            disabled={sumState === 'streaming'}
          >
            {sumState === 'streaming'
              ? '✦ Summarizing…'
              : sumState === 'done'
              ? '✦ Summarized'
              : '✦ Summarize'}
          </button>

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
      </div>
    </article>
  );
}
