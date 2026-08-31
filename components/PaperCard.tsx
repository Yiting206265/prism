'use client';

import { useState, useEffect, useRef } from 'react';

import type { Paper } from '@/lib/providers/types';
export type { Paper };

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
type Variant = 'featured' | 'grid';
type CoverState = 'idle' | 'loading' | 'done' | 'error';
type SpeechState = 'idle' | 'loading' | 'speaking';

// Only one card should play audio at a time. Whichever card is currently
// playing registers itself here so a new play request can silence it.
let activeSpeech: { audio: HTMLAudioElement; stop: () => void } | null = null;

interface Props {
  paper: Paper;
  index: number;
  variant?: Variant;
  onSummarized?: () => void;
  onImageClick?: (src: string) => void;
}

// Only used for the rare AI-generation fallback when a paper has no usable
// arXiv figure — not user-facing, so no need for a model picker.
const COVER_MODEL = 'flux-1-schnell';

export default function PaperCard({ paper, index, variant = 'grid', onSummarized, onImageClick }: Props) {
  const [expanded, setExpanded] = useState(variant === 'featured');
  const [summary, setSummary]   = useState('');
  const [sumState, setSumState] = useState<SumState>('idle');
  const [summaryVisible, setSummaryVisible] = useState(true);
  const [coverUrl, setCoverUrl]     = useState('');
  const [coverState, setCoverState] = useState<CoverState>('idle');
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const cardRef = useRef<HTMLElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function stopSpeech() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audioRef.current = null;
      if (activeSpeech?.audio === audio) activeSpeech = null;
    }
    setSpeechState('idle');
  }

  // Stop this card's audio if it unmounts (e.g. scrolled out during pagination)
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        if (activeSpeech?.audio === audio) activeSpeech = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          // stagger requests so cards don't all fire simultaneously
          setTimeout(fetchCover, (index % 5) * 600);
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchCover() {
    if (coverState !== 'idle') return;
    setCoverState('loading');
    try {
      // GET + query params (not a POST body) so the response is cacheable —
      // by the browser and by Vercel's edge network — instead of being
      // regenerated on every visit. See app/api/cover/route.ts for why.
      const params = new URLSearchParams({
        title: paper.title,
        abstract: paper.abstract,
        model: COVER_MODEL,
      });
      if (paper.source === 'arxiv') params.set('arxivId', paper.id);
      if (paper.source === 'pubmed') params.set('pmid', paper.id);

      const res = await fetch(`/api/cover?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      setCoverUrl(URL.createObjectURL(blob));
      setCoverState('done');
    } catch {
      setCoverState('error');
    }
  }

  const primaryCats = paper.categories.slice(0, 3);

  async function handleSummarize() {
    if (sumState === 'streaming') return;
    if (sumState === 'done') {
      setSummaryVisible((v) => !v);
      return;
    }

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
      onSummarized?.();
    } catch {
      setSummary('Could not generate summary. Please try again.');
      setSumState('error');
    }
  }

  async function handleListen() {
    if (speechState === 'speaking' || speechState === 'loading') {
      stopSpeech();
      return;
    }

    // Only one card should play audio at a time.
    activeSpeech?.stop();

    setSpeechState('loading');
    const text = sumState === 'done' && summary ? summary : paper.abstract;

    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (activeSpeech?.audio === audio) activeSpeech = null;
        if (audioRef.current === audio) audioRef.current = null;
        setSpeechState('idle');
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;

      activeSpeech = { audio, stop: stopSpeech };
      await audio.play();
      setSpeechState('speaking');
    } catch {
      setSpeechState('idle');
    }
  }

  return (
    <article
      ref={cardRef}
      className={`paper-card-${variant}`}
      style={{ animationDelay: `${Math.min((index - 1) * 40, 400)}ms` }}
    >
      {/* Cover — full-bleed image header, separate from text below */}
      <div className="paper-cover-frame">
        {variant === 'featured' && (
          <span className="paper-featured-label">Latest</span>
        )}
        {(coverState === 'idle' || coverState === 'loading') && (
          <div className="paper-cover-placeholder skeleton-block" aria-hidden="true" />
        )}
        {coverState === 'done' && coverUrl && (
          <button
            type="button"
            className="paper-cover-img-btn"
            onClick={() => onImageClick?.(coverUrl)}
            aria-label="View full-size figure"
          >
            <img
              src={coverUrl}
              alt=""
              className="paper-cover-img"
            />
          </button>
        )}
        {coverState === 'error' && (
          <div className="paper-cover-placeholder" aria-hidden="true" />
        )}
      </div>

      <div className="paper-content">
        {/* Title */}
        <h2 className="paper-title">
          <a href={paper.absUrl} target="_blank" rel="noopener noreferrer" title={paper.title}>
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
      {(summary || sumState === 'streaming') && summaryVisible && (
        <div className="paper-summary" tabIndex={0}>
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
        {variant === 'grid' && (
          <button
            className="action-btn"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
          >
            {expanded ? 'Close' : 'Abstract'}
          </button>
        )}

        <button
          className={`action-btn ai-btn${sumState === 'done' ? ' summarized' : ''}`}
          onClick={handleSummarize}
          disabled={sumState === 'streaming'}
          aria-expanded={sumState === 'done' ? summaryVisible : undefined}
        >
          {sumState === 'streaming'
            ? 'Summary…'
            : sumState === 'done'
            ? summaryVisible ? 'Hide' : 'Summary'
            : 'Summary'}
        </button>

        <button
          className={`action-btn listen-btn${speechState !== 'idle' ? ' speaking' : ''}`}
          onClick={handleListen}
          disabled={speechState === 'loading'}
        >
          {speechState === 'loading'
            ? 'Listen…'
            : speechState === 'speaking'
            ? 'Stop'
            : 'Listen'}
        </button>

        {paper.source === 'pubmed' ? (
          <a
            href={paper.absUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="action-btn pdf-btn"
          >
            PubMed
          </a>
        ) : (
          <>
            <a
              href={paper.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="action-btn pdf-btn"
            >
              PDF
            </a>

            <a
              href={paper.absUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="action-btn"
            >
              arXiv
            </a>
          </>
        )}
        </div>
      </div>{/* end paper-content */}
    </article>
  );
}
