import Header from '@/components/Header';
import PapersClient from '@/components/PapersClient';

export default function Home() {
  return (
    <main>
      <Header />

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-overline">
            <span>arXiv</span>
            <span className="hero-overline-dot" aria-hidden="true" />
            <span>Live Preprints</span>
            <span className="hero-overline-dot" aria-hidden="true" />
            <span>AI Summaries</span>
          </div>
          <h1 className="hero-display">
            The latest research,<br />
            <em>instantly understood.</em>
          </h1>
          <div className="hero-rule" aria-hidden="true" />
          <p className="hero-tagline">
            Browse fresh preprints by category. One click for an AI summary.
          </p>
        </div>
      </section>

      <PapersClient />
    </main>
  );
}
