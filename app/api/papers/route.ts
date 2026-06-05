import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'cs.AI';
  const maxResults = Math.min(parseInt(searchParams.get('maxResults') || '20', 10), 50);
  const start = Math.max(parseInt(searchParams.get('start') || '0', 10), 0);

  if (!/^[a-zA-Z0-9.\-]+$/.test(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  try {
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
        .map((a: string) => a.trim())
        .filter(Boolean);

      // Strip the "arXiv:XXXX Announce Type: xxx \nAbstract: " prefix from description
      const rawDesc = typeof item.description === 'string' ? item.description : '';
      const abstractMatch = rawDesc.match(/Abstract:\s*([\s\S]*)/i);
      const abstract = abstractMatch
        ? abstractMatch[1].replace(/\s+/g, ' ').trim()
        : rawDesc.replace(/\s+/g, ' ').trim();

      const categories = Array.isArray(item.category)
        ? item.category
        : item.category
        ? [item.category]
        : [];

      const absUrl = typeof item.link === 'string' ? item.link : `https://arxiv.org/abs/${arxivId}`;

      return {
        id: arxivId || `paper-${index}`,
        index: index + 1,
        title: (item.title || '').replace(/\s+/g, ' ').trim(),
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
