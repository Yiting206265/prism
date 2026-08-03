import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';

const CATEGORIES = [
  'cs.AI',
  'cs.LG',
  'cs.CV',
  'cs.CL',
  'cs.RO',
  'cs.NE',
  'cs.IR',
  'stat.ML',
  'quant-ph',
  'cond-mat.mes-hall',
  'hep-th',
  'astro-ph.GA',
  'physics.optics',
  'q-bio.NC',
  'q-bio.GN',
  'q-bio.BM',
  'q-bio.QM',
  'math.ST',
  'math.OC',
  'math.CO',
  'math.PR',
  'q-fin.TR',
  'q-fin.PM',
  'q-fin.RM',
] as const;

async function fetchCategoryTotal(category: string): Promise<number> {
  try {
    const url = `https://rss.arxiv.org/rss/${category}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)',
      },
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

export async function GET() {
  try {
    const results = await Promise.all(
      CATEGORIES.map(async (code) => {
        const total = await fetchCategoryTotal(code);
        return [code, total] as const;
      })
    );

    const counts: Record<string, number> = {};
    let grandTotal = 0;
    for (const [code, total] of results) {
      counts[code] = total;
      grandTotal += total;
    }

    return NextResponse.json({
      counts,
      grandTotal,
      categoriesLive: results.filter(([, t]) => t > 0).length,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[stats] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch category stats.' },
      { status: 500 }
    );
  }
}
