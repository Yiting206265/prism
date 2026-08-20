import { XMLParser } from 'fast-xml-parser';
import { cleanLatexText } from '@/lib/cleanText';
import { fetchArxivXml } from '@/lib/arxivFetch';
import type { Paper, FeedResult, Provider } from './types';

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

async function fetchByDate(
  category: string,
  dateStr: string,
  start: number,
  maxResults: number,
  retries?: number
): Promise<FeedResult> {
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

  const papers: Paper[] = entries.map((entry, index) => {
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
      source: 'arxiv',
    };
  });

  return { papers, total };
}

async function fetchToday(category: string, start: number, maxResults: number): Promise<FeedResult> {
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

  const allPapers: Paper[] = items.map((item, index) => {
    const guidStr = typeof item.guid === 'string'
      ? item.guid
      : (item.guid as { '#text': string })?.['#text'] ?? '';
    const arxivId = guidStr.replace('oai:arXiv.org:', '');

    const authors = (item['dc:creator'] ?? '')
      .split(',')
      .map((a: string) => cleanLatexText(a))
      .filter(Boolean);

    const rawDesc = typeof item.description === 'string' ? item.description : '';
    const abstractMatch = rawDesc.match(/Abstract:\s*([\s\S]*)/i);
    const abstract = cleanLatexText(abstractMatch ? abstractMatch[1] : rawDesc);

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
      source: 'arxiv',
    };
  });

  const papers = allPapers.slice(start, start + maxResults);
  return { papers, total: allPapers.length };
}

async function fetchCount(category: string): Promise<number> {
  try {
    const url = `https://rss.arxiv.org/rss/${category}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
      next: { revalidate: 300 },
    });
    if (!response.ok) return 0;

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['item', 'category'].includes(name),
    });
    const result = parser.parse(xml);
    const items = result?.rss?.channel?.item ?? [];
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

export const arxivProvider: Provider = {
  async fetchFeed(category, date, start, maxResults, retries) {
    return date !== null
      ? fetchByDate(category, date, start, maxResults, retries)
      : fetchToday(category, start, maxResults);
  },
  fetchCount,
};
