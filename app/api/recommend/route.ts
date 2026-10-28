import { NextRequest, NextResponse } from 'next/server';
import { readProfile, recommend } from '@/lib/recommend';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const profile = readProfile(body);
  if (!profile) {
    return NextResponse.json({ error: 'Describe what you work on.' }, { status: 400 });
  }

  try {
    const result = await recommend(profile);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    console.error('[recommend] failed:', message || error);
    return NextResponse.json({ error: 'Could not build today’s list. Try again in a moment.' }, { status: 502 });
  }
}
