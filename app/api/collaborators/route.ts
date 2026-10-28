import { NextRequest, NextResponse } from 'next/server';
import { findListedCollaborators, lookupNames } from '@/lib/openalex';

export const maxDuration = 20;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const record = body && typeof body === 'object' ? body as { expertise?: unknown; people?: unknown } : {};
  const expertise = typeof record.expertise === 'string' ? record.expertise : '';
  const people = typeof record.people === 'string' ? record.people : '';
  const names = lookupNames(expertise, people);
  if (!names.length) {
    return NextResponse.json({ error: 'Type a person’s name, like Sarah Seager.' }, { status: 400 });
  }

  try {
    const found = await findListedCollaborators(expertise, people);
    if (!found?.collaborators.length) {
      return NextResponse.json({ error: `No collaborators found for ${names.join(', ')}.` }, { status: 404 });
    }
    return NextResponse.json(found);
  } catch (error) {
    console.error('[collaborators] failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not look up collaborators. Try again in a moment.' }, { status: 502 });
  }
}
