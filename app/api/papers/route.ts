import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';

interface ArxivAuthor {
  name: string;
}

interface ArxivCategory {
  '@_term': string;
  '@_scheme': string;
}

interface ArxivLink {
  '@_href': string;
  '@_rel': string;
  '@_type'?: string;
  '@_title'?: string;
}

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  author: ArxivAuthor | ArxivAuthor[];
  category: ArxivCategory | ArxivCategory[];
  link: ArxivLink | ArxivLink[];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'cs.AI';
  const maxResults = Math.min(parseInt(searchParams.get('maxResults') || '20', 10), 50);

  // Validate category to prevent injection
  if (!/^[a-zA-Z0-9.\-]+$/.test(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  try {
    const url = `https://export.arxiv.org/api/query?search_query=cat:${category}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`arXiv returned ${response.status}`);
    }

    const xml = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['entry', 'author', 'category', 'link'].includes(name),
    });

    const result = parser.parse(xml);
    const feed = result.feed;

    if (!feed) {
      throw new Error('Invalid feed response');
    }

    const entries: ArxivEntry[] = Array.isArray(feed.entry)
      ? feed.entry
      : feed.entry
      ? [feed.entry]
      : [];

    const papers = entries.map((entry, index) => {
      const authorList = Array.isArray(entry.author)
        ? entry.author
        : entry.author
        ? [entry.author]
        : [];

      const categoryList = Array.isArray(entry.category)
        ? entry.category
        : entry.category
        ? [entry.category]
        : [];

      const linkList = Array.isArray(entry.link)
        ? entry.link
        : entry.link
        ? [entry.link]
        : [];

      const authors = authorList.map((a) => a.name).filter(Boolean);
      const categories = categoryList.map((c) => c['@_term']).filter(Boolean);

      const pdfLink = linkList.find((l) => l['@_type'] === 'application/pdf');
      const absLink = linkList.find((l) => l['@_rel'] === 'alternate');

      // Extract arXiv ID from URL like http://arxiv.org/abs/2501.12345v1
      const idStr = typeof entry.id === 'string' ? entry.id.trim() : '';
      const arxivId = idStr.includes('/abs/')
        ? idStr.split('/abs/')[1]
        : idStr;

      return {
        id: arxivId || `paper-${index}`,
        index: index + 1,
        title: (entry.title || '').replace(/\s+/g, ' ').trim(),
        authors,
        abstract: (entry.summary || '').replace(/\s+/g, ' ').trim(),
        published: entry.published,
        updated: entry.updated,
        categories,
        pdfUrl: pdfLink?.['@_href'] || `https://arxiv.org/pdf/${arxivId}`,
        absUrl: absLink?.['@_href'] || `https://arxiv.org/abs/${arxivId}`,
      };
    });

    const total = parseInt(
      String(feed['opensearch:totalResults'] ?? papers.length),
      10
    );

    return NextResponse.json({ papers, total, category });
  } catch (error) {
    console.error('[papers] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch papers from arXiv. Please try again.' },
      { status: 500 }
    );
  }
}
