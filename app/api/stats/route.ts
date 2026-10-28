import { NextResponse } from 'next/server';
import { CATEGORIES } from '@/lib/categories';
import { getProvider } from '@/lib/providers';

export async function GET() {
  try {
    const arxivCats = CATEGORIES.filter((c) => c.provider === 'arxiv');
    const pubmedCats = CATEGORIES.filter((c) => c.provider === 'pubmed');

    const arxivResults = await Promise.all(
      arxivCats.map(async (cat) => {
        const total = await getProvider('arxiv').fetchCount(cat.id);
        return [cat.id, total] as const;
      })
    );

    // NCBI's public rate limit is 3 req/sec — running all 5 medical
    // categories' count checks concurrently (like arXiv's 24) triggers a
    // 429. Sequential awaits naturally space these out enough (each
    // request takes a few hundred ms) without needing an artificial delay.
    const pubmedProvider = getProvider('pubmed');
    const pubmedResults: (readonly [string, number])[] = [];
    for (const cat of pubmedCats) {
      const total = await pubmedProvider.fetchCount(cat.id);
      pubmedResults.push([cat.id, total]);
    }

    const results = [...arxivResults, ...pubmedResults];

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
