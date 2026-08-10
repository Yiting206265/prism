import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { cleanLatexText } from '@/lib/cleanText';
import { fetchArxivXml } from '@/lib/arxivFetch';
import { isValidDate, MAX_DAYS_BACK } from '@/lib/dateRange';

interface RssItem {
  title: string;
  link: string;
  description: string;
  guid: string | { '#text': string };
  pubDate: string;
  'arxiv:announce_type'?: string;
  'dc:creator'?: string;
  category: string | string[];
}

interface AtomAuthor {
  name: string;
}

interface AtomCategory {
  '@_term': string;
}

interface AtomEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  author?: AtomAuthor | AtomAuthor[];
  category?: AtomCategory | AtomCategory[];
}

async function fetchByDate(category: string, dateStr: string, start: number, maxResults: number, retries?: number) {
  const yyyymmdd = dateStr.replace(/-/g, '');
  const searchQuery = `cat:${category}+AND+submittedDate:[${yyyymmdd}0000+TO+${yyyymmdd}2359]`;
  const url =
    `https://export.arxiv.org/api/query?search_query=${searchQuery}` +
    `&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${maxResults}`;

  const xml = await fetchArxivXml(url, retries);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['entry', 'author', 'category'].includes(name),
  });

  const result = parser.parse(xml);
  const entries: AtomEntry[] = result?.feed?.entry ?? [];
  const total = parseInt(result?.feed?.['opensearch:totalResults'] ?? '0', 10) || 0;

  const papers = entries.map((entry, index) => {
    const arxivId = entry.id.replace('http://arxiv.org/abs/', '').replace('https://arxiv.org/abs/', '');

    const authors = (Array.isArray(entry.author) ? entry.author : entry.author ? [entry.author] : [])
      .map((a) => cleanLatexText(a.name))
      .filter(Boolean);

    const categories = (Array.isArray(entry.category) ? entry.category : entry.category ? [entry.category] : [])
      .map((c) => c['@_term'])
      .filter(Boolean);

    return {
      id: arxivId || `paper-${index}`,
      index: start + index + 1,
      title: cleanLatexText(entry.title || ''),
      authors,
      abstract: cleanLatexText(entry.summary || ''),
      published: entry.published,
      updated: entry.updated,
      categories,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
    };
  });

  return { papers, total };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'cs.AI';
  const maxResults = Math.min(parseInt(searchParams.get('maxResults') || '20', 10), 50);
  const start = Math.max(parseInt(searchParams.get('start') || '0', 10), 0);
  const date = searchParams.get('date');
  // Callers that space out many requests themselves (the per-category count
  // sweep) opt out of in-request retries — see fetchArxivXml for why
  // retrying here would undermine that external spacing.
  const noRetry = searchParams.get('noRetry') === '1';

  if (!/^[a-zA-Z0-9.\-]+$/.test(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  if (date !== null && !isValidDate(date)) {
    return NextResponse.json(
      { error: `Invalid date. Must be YYYY-MM-DD within the last ${MAX_DAYS_BACK} days.` },
      { status: 400 }
    );
  }

  try {
    if (date !== null) {
      const { papers, total } = await fetchByDate(category, date, start, maxResults, noRetry ? 0 : undefined);
      return NextResponse.json({ papers, total, category, date });
    }

    const url = `https://rss.arxiv.org/rss/${category}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`arXiv RSS returned ${response.status}`);
    }

    const xml = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['item', 'category'].includes(name),
    });

    const result = parser.parse(xml);
    const items: RssItem[] = result?.rss?.channel?.item ?? [];

    const allPapers = items.map((item, index) => {
      // Extract arXiv ID from guid like "oai:arXiv.org:2606.04037v2"
      const guidStr = typeof item.guid === 'string'
        ? item.guid
        : (item.guid as { '#text': string })?.['#text'] ?? '';
      const arxivId = guidStr.replace('oai:arXiv.org:', '');

      // Authors are comma-separated in dc:creator
      const authors = (item['dc:creator'] ?? '')
        .split(',')
        .map((a: string) => cleanLatexText(a))
        .filter(Boolean);

      // Strip the "arXiv:XXXX Announce Type: xxx \nAbstract: " prefix from description
      const rawDesc = typeof item.description === 'string' ? item.description : '';
      const abstractMatch = rawDesc.match(/Abstract:\s*([\s\S]*)/i);
      const abstract = cleanLatexText(
        abstractMatch ? abstractMatch[1] : rawDesc
      );

      const categories = Array.isArray(item.category)
        ? item.category
        : item.category
        ? [item.category]
        : [];

      const absUrl = typeof item.link === 'string' ? item.link : `https://arxiv.org/abs/${arxivId}`;

      return {
        id: arxivId || `paper-${index}`,
        index: index + 1,
        title: cleanLatexText(item.title || ''),
        authors,
        abstract,
        published: item.pubDate,
        updated: item.pubDate,
        categories,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
        absUrl,
      };
    });

    const papers = allPapers.slice(start, start + maxResults);

    return NextResponse.json({ papers, total: allPapers.length, category });
  } catch (error) {
    console.error('[papers] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch papers from arXiv. Please try again.' },
      { status: 500 }
    );
  }
}
