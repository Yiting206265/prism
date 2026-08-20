import { NextResponse } from 'next/server';
import { CATEGORIES } from '@/lib/categories';
import { getProvider } from '@/lib/providers';

export async function GET() {
  try {
    const results = await Promise.all(
      CATEGORIES.map(async (cat) => {
        const provider = getProvider(cat.provider);
        const total = await provider.fetchCount(cat.id);
        return [cat.id, total] as const;
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
