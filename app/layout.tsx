import type { Metadata } from 'next';
import { Cormorant, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const cormorant = Cormorant({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
  display: 'swap',
});

const ibmMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-ibm-mono',
  display: 'swap',
});

const ibmSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-ibm-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Prism — Research, refracted.',
  description:
    'Discover the latest arXiv preprints with AI-powered summaries. A faster, more beautiful way to stay on top of research.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${ibmMono.variable} ${ibmSans.variable}`}
    >
      <head>
        {/* Prevent flash of wrong theme on load */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('prism-theme');document.documentElement.setAttribute('data-theme',t||'dark');})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
