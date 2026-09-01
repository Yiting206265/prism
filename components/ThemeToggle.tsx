'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark'); // matches script default

  useEffect(() => {
    const stored = localStorage.getItem('prism-theme') as 'dark' | 'light' | null;
    const initial = stored ?? 'dark'; // must match the script default in layout.tsx
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('prism-theme', next);
  }

  const toLight = theme === 'dark';

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${toLight ? 'light' : 'dark'} mode`}
      title={`Switch to ${toLight ? 'light' : 'dark'} mode`}
    >
      {toLight ? (
        <svg viewBox="0 0 24 24" className="theme-toggle-icon" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="theme-toggle-icon" aria-hidden="true">
          <path
            d="M15.2 3.1A8.6 8.6 0 1 0 20.9 13 7 7 0 0 1 15.2 3.1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
