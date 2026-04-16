import ThemeToggle from './ThemeToggle';

export default function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="logo">
          {/* Inline SVG so strokes follow currentColor (text color) on both themes */}
          <svg
            width="26"
            height="26"
            viewBox="0 0 100 100"
            fill="none"
            className="logo-img"
            aria-hidden="true"
          >
            <polygon
              points="50,8 10,82 90,82"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <line x1="12" y1="38" x2="34" y2="52" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="34" cy="52" r="2.5" fill="currentColor"/>
            {/* Refracted spectrum rays keep their vivid colors */}
            <line x1="66" y1="55" x2="94" y2="42" stroke="#e87c3a" strokeWidth="2.2" strokeLinecap="round"/>
            <line x1="67" y1="59" x2="94" y2="52" stroke="#efc84a" strokeWidth="2.2" strokeLinecap="round"/>
            <line x1="68" y1="63" x2="95" y2="63" stroke="#72b896" strokeWidth="2.2" strokeLinecap="round"/>
            <line x1="68" y1="67" x2="94" y2="74" stroke="#4a90d9" strokeWidth="2.2" strokeLinecap="round"/>
            <line x1="66" y1="71" x2="90" y2="84" stroke="#9b6dd6" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>

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
            API ↗
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
