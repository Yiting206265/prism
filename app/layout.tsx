import type { Metadata } from 'next';
import { Oswald, Barlow, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-oswald',
  display: 'swap',
});

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
});

const ibmMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-ibm-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Prism',
  description:
    'Discover the latest arXiv preprints with AI-powered summaries. A faster, more beautiful way to stay on top of research.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${oswald.variable} ${barlow.variable} ${ibmMono.variable}`}
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
