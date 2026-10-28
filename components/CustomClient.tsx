'use client';

import { FormEvent, useEffect, useState } from 'react';
import PaperCard, { type Paper } from './PaperCard';
import Lightbox from './Lightbox';

interface Profile {
  expertise: string;
  people: string;
  follow: string;
}

interface SavedResult {
  day: string;
  profileKey: string;
  papers: Paper[];
  reasons: Record<string, string>;
}

const PROFILE_KEY = 'prism-custom-profile';
const RESULT_KEY = 'prism-custom-result-v6';
const FIRST_COUNT = 10;
const LOAD_COUNT = 20;
const EMPTY: Profile = {
  expertise: '',
  people: '',
  follow: '',
};

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function profileStamp(profile: Profile): string {
  return [profile.expertise, profile.people, profile.follow].join('\n').trim();
}

export default function CustomClient() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [shown, setShown] = useState(FIRST_COUNT);
  const [finding, setFinding] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PROFILE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Profile>;
        setProfile({
          expertise: typeof parsed.expertise === 'string' ? parsed.expertise : '',
          people: typeof parsed.people === 'string' ? parsed.people : '',
          follow: typeof parsed.follow === 'string' ? parsed.follow : '',
        });
      }
      const saved = localStorage.getItem(RESULT_KEY);
      if (saved) {
        const result = JSON.parse(saved) as SavedResult;
        if (result.day === todayUTC() && result.profileKey === profileStamp({ ...EMPTY, ...JSON.parse(stored || '{}') })) {
          setPapers(result.papers || []);
          setShown(FIRST_COUNT);
          setStatus('done');
        }
      }
    } catch {
      /* ignore a bad saved profile */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile, ready]);

  function setField<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
    if (status !== 'loading') {
      setStatus('idle');
      setMessage(null);
    }
  }

  async function findCollaborators() {
    if (profile.expertise.trim().length < 3 && profile.people.trim().length < 3) {
      setStatus('error');
      setMessage('Type a person’s name, like Sarah Seager.');
      return;
    }
    setFinding(true);
    try {
      const res = await fetch('/api/collaborators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expertise: profile.expertise, people: profile.people }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Could not look up collaborators.');
      }
      const names: string[] = Array.isArray(data.collaborators)
        ? data.collaborators.filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
        : [];
      if (!names.length) throw new Error('No collaborators found for that name.');
      setProfile((prev) => {
        const existing = prev.people.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
        const seen = new Set(existing.map((part) => part.toLowerCase()));
        const added = names.filter((name) => !seen.has(name.toLowerCase()));
        return { ...prev, people: [...existing, ...added].join(', ').slice(0, 400) };
      });
      setStatus('idle');
      const author = typeof data.author === 'string' ? data.author : 'that person';
      setMessage(`Added people who publish with ${author}.`);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not look up collaborators.');
    } finally {
      setFinding(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profile.expertise.trim().length < 8) {
      setStatus('error');
      setMessage('Describe what you work on.');
      return;
    }

    setStatus('loading');
    setMessage(null);
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Could not build today’s list.');
      }
      const nextPapers: Paper[] = Array.isArray(data.papers) ? data.papers : [];
      const nextReasons: Record<string, string> = data.reasons && typeof data.reasons === 'object' ? data.reasons : {};
      setPapers(nextPapers);
      setShown(FIRST_COUNT);
      setStatus('done');
      if (!nextPapers.length) setMessage('Nothing recent matched. Try a broader description.');
      else setMessage(null);
      const saved: SavedResult = {
        day: typeof data.day === 'string' ? data.day : todayUTC(),
        profileKey: profileStamp(profile),
        papers: nextPapers,
        reasons: nextReasons,
      };
      localStorage.setItem(RESULT_KEY, JSON.stringify(saved));
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not build today’s list.');
    }
  }

  const visible = papers.slice(0, shown);
  const [featured, ...rest] = visible;

  return (
    <div className="custom-page">
      <section className="custom-panel" aria-labelledby="custom-title">
        <div className="custom-intro">
          <h1 id="custom-title" className="custom-title">Customized</h1>
          <p className="custom-copy">
            Your own feed of recent papers.
          </p>
        </div>

        <form className="custom-form" onSubmit={onSubmit}>
          <label className="custom-label" htmlFor="custom-expertise">What you work on</label>
          <textarea
            id="custom-expertise"
            className="custom-input custom-textarea"
            required
            maxLength={800}
            rows={4}
            placeholder="Sara Seager, exoplanet atmospheres"
            value={profile.expertise}
            onChange={(e) => setField('expertise', e.target.value)}
          />

          <label className="custom-label" htmlFor="custom-people">
            Group and collaborators <span className="custom-optional">optional</span>
          </label>
          <textarea
            id="custom-people"
            className="custom-input custom-textarea"
            maxLength={400}
            rows={2}
            placeholder="Sara Seager, Josh Winn"
            value={profile.people}
            onChange={(e) => setField('people', e.target.value)}
          />
          <button
            type="button"
            className="custom-lookup"
            onClick={findCollaborators}
            disabled={finding || status === 'loading'}
          >
            {finding ? 'Looking up collaborators…' : 'Find collaborators'}
          </button>

          <label className="custom-label" htmlFor="custom-follow">
            Authors or papers to follow <span className="custom-optional">optional</span>
          </label>
          <textarea
            id="custom-follow"
            className="custom-input custom-textarea"
            maxLength={400}
            rows={2}
            placeholder="A few author names, or titles you already care about"
            value={profile.follow}
            onChange={(e) => setField('follow', e.target.value)}
          />

          <div className="custom-actions">
            <button type="submit" className="custom-submit" disabled={status === 'loading'}>
              {status === 'loading' ? 'Looking…' : 'Show today’s papers'}
            </button>
            {message && (
              <p className={`custom-status${status === 'error' ? ' is-error' : ''}`} role="status">
                {message}
              </p>
            )}
          </div>
        </form>
      </section>

      {status === 'done' && papers.length > 0 && (
        <section className="custom-results" aria-label="Recommended papers">
          {featured && (
            <div className="recommend-item">
              <PaperCard
                paper={featured}
                index={1}
                variant="featured"
                onImageClick={(src) => setLightboxSrc(src)}
              />
            </div>
          )}
          {rest.length > 0 && (
            <div className="papers-grid">
              {rest.map((paper, i) => (
                <div key={paper.id} className="recommend-item">
                  <PaperCard
                    paper={paper}
                    index={i + 2}
                    variant="grid"
                    onImageClick={(src) => setLightboxSrc(src)}
                  />
                </div>
              ))}
            </div>
          )}
          {shown < papers.length && (
            <div className="load-more-wrap">
              <button
                type="button"
                className="load-more-btn"
                onClick={() => setShown((count) => Math.min(papers.length, count + LOAD_COUNT))}
              >
                {`Load more  ·  ${shown} of ${papers.length}`}
              </button>
            </div>
          )}
        </section>
      )}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
