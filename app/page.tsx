import Header from '@/components/Header';
import PapersClient from '@/components/PapersClient';

export default function Home() {
  return (
    <main>
      <Header />

      <section className="hero">
        <div className="hero-inner">
          <p className="hero-eyebrow">arXiv · Live Preprints</p>
          <h1 className="hero-title">
            The latest research,<br />
            <em>instantly understood.</em>
          </h1>
          <p className="hero-sub">
            Browse fresh preprints by category. One click for an AI summary —
            no paywalls, no clutter.
          </p>
        </div>
      </section>

      <PapersClient />
    </main>
  );
}
