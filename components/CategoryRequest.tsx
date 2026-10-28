'use client';

import { FormEvent, useState } from 'react';
import { CATEGORIES } from '@/lib/categories';

function matchingCategory(raw: string) {
  const q = raw.trim().toLowerCase();
  if (!q) return undefined;
  return CATEGORIES.find(
    (c) =>
      c.id.toLowerCase() === q ||
      c.label.toLowerCase() === q ||
      c.name.toLowerCase() === q
  );
}

export default function CategoryRequest() {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setStatus('error');
      setMessage('Name the category you want added.');
      return;
    }

    const existing = matchingCategory(trimmed);
    if (existing) {
      setStatus('error');
      setMessage(`${existing.name} is already on Prism.`);
      return;
    }

    setStatus('sending');
    setMessage(null);

    try {
      const res = await fetch('/api/category-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          note: note.trim(),
          email: email.trim(),
          company,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && typeof data.existing === 'string') {
        setStatus('error');
        setMessage(`${data.existing} is already on Prism.`);
        return;
      }
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'Could not send that request.'
        );
      }
      setStatus('sent');
      setMessage('Request sent.');
      setName('');
      setNote('');
      setEmail('');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Could not send that request.');
    }
  }

  return (
    <div className="category-request-slot">
    <section className="category-request" aria-labelledby="category-request-title">
      <div className="category-request-intro">
        <h2 id="category-request-title" className="category-request-title">
          Request a category
        </h2>
        <p className="category-request-copy">
          Name a field that should be on Prism.
        </p>
      </div>

      <form className="category-request-form" onSubmit={onSubmit}>
        <div className="category-request-trap" aria-hidden="true">
          <label htmlFor="category-request-company">Company</label>
          <input
            id="category-request-company"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>

        <div className="category-request-field">
          <label className="category-request-label" htmlFor="category-request-name">
            Category
          </label>
          <input
            id="category-request-name"
            className="category-request-input"
            name="category"
            type="text"
            required
            maxLength={80}
            autoComplete="off"
            placeholder="Cryptography, Dermatology, cs.CR"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (status !== 'sending') {
                setStatus('idle');
                setMessage(null);
              }
            }}
          />
        </div>

        <div className="category-request-field">
          <label className="category-request-label" htmlFor="category-request-note">
            Note <span className="category-request-optional">optional</span>
          </label>
          <textarea
            id="category-request-note"
            className="category-request-input category-request-textarea"
            name="note"
            maxLength={500}
            rows={3}
            placeholder="arXiv code, PubMed topic, or why it belongs"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="category-request-field">
          <label className="category-request-label" htmlFor="category-request-email">
            Email <span className="category-request-optional">optional</span>
          </label>
          <input
            id="category-request-email"
            className="category-request-input"
            name="email"
            type="email"
            maxLength={120}
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="category-request-actions">
          <button
            type="submit"
            className="category-request-submit"
            disabled={status === 'sending'}
          >
            {status === 'sending' ? 'Sending…' : 'Send request'}
          </button>
          {message && (
            <p
              className={`category-request-status${status === 'error' ? ' is-error' : ''}${status === 'sent' ? ' is-sent' : ''}`}
              role="status"
            >
              {message}
            </p>
          )}
        </div>
      </form>
    </section>
    </div>
  );
}
