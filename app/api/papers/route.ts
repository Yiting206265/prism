import { NextRequest, NextResponse } from 'next/server';
import { getCategory } from '@/lib/categories';
import { getProvider } from '@/lib/providers';
import { isValidDate, MAX_DAYS_BACK } from '@/lib/dateRange';

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

  const categoryDef = getCategory(category);
  if (!categoryDef) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  if (date !== null && !isValidDate(date)) {
    return NextResponse.json(
      { error: `Invalid date. Must be YYYY-MM-DD within the last ${MAX_DAYS_BACK} days.` },
      { status: 400 }
    );
  }

  try {
    const provider = getProvider(categoryDef.provider);
    const { papers, total } = await provider.fetchFeed(category, date, start, maxResults, noRetry ? 0 : undefined);
    return NextResponse.json(date !== null ? { papers, total, category, date } : { papers, total, category });
  } catch (error) {
    console.error('[papers] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch papers. Please try again.' },
      { status: 500 }
    );
  }
}
