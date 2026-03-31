import ThemeToggle from './ThemeToggle';

export default function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="logo">
          <img src="/logo.svg" alt="" className="logo-img" aria-hidden="true" />
          <span className="logo-name">Prism</span>
          <span className="logo-dot" aria-hidden="true" />
          <span className="logo-tagline">Research, refracted.</span>
        </div>

        <nav className="header-actions">
          <a
            href="https://arxiv.org"
            target="_blank"
            rel="noopener noreferrer"
            className="header-link"
          >
            arXiv ↗
          </a>
          <a
            href="https://arxiv.org/help/api"
            target="_blank"
            rel="noopener noreferrer"
            className="header-link"
          >
            API Docs ↗
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
