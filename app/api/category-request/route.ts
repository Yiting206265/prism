import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { CATEGORIES } from '@/lib/categories';

const MAX_NAME = 80;
const MAX_NOTE = 500;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

const hits = new Map<string, number[]>();

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function matchingCategory(raw: string) {
  const q = raw.trim().toLowerCase();
  return CATEGORIES.find(
    (c) =>
      c.id.toLowerCase() === q ||
      c.label.toLowerCase() === q ||
      c.name.toLowerCase() === q
  );
}

async function saveLocal(entry: Record<string, string>): Promise<boolean> {
  try {
    const dir = join(process.cwd(), '.data');
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'category-requests.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
    return true;
  } catch (error) {
    console.error('[category-request] file save failed:', error);
    return false;
  }
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  // Hidden field. Real visitors leave it empty; bots that fill it get a fake ok.
  if (typeof record.company === 'string' && record.company.trim()) {
    return NextResponse.json({ ok: true });
  }

  const name = clean(record.name, MAX_NAME);
  const note = clean(record.note, MAX_NOTE);
  const email = clean(record.email, 120);

  if (name.length < 2) {
    return NextResponse.json({ error: 'Name the category you want added.' }, { status: 400 });
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'That email does not look right.' }, { status: 400 });
  }

  const existing = matchingCategory(name);
  if (existing) {
    return NextResponse.json(
      { error: 'Already on Prism.', existing: existing.name },
      { status: 409 }
    );
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  const entry = {
    at: new Date().toISOString(),
    name,
    note,
    email,
  };

  const origin = request.headers.get('origin') || request.nextUrl.origin;
  const emailed = await sendToInbox(entry, origin);
  const saved = await saveLocal(entry);
  if (!emailed.ok) {
    console.error('[category-request] email failed:', emailed.message);
    if (!saved) {
      return NextResponse.json({ error: 'Could not send that request.' }, { status: 502 });
    }
    return NextResponse.json(
      { error: 'Could not send that request. Try again in a moment.' },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}

const INBOX = 'yitingli302@gmail.com';

async function sendToInbox(
  entry: { name: string; note: string; email: string },
  origin: string
): Promise<{ ok: boolean; message?: string }> {
  const to = process.env.CATEGORY_REQUEST_TO || INBOX;
  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey) {
    const from = process.env.CATEGORY_REQUEST_FROM || 'Prism <onboarding@resend.dev>';
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      replyTo: entry.email || undefined,
      subject: `Prism category request: ${entry.name}`,
      text: [
        `Category: ${entry.name}`,
        entry.email ? `Reply to: ${entry.email}` : 'Reply to: (none left)',
        entry.note,
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
    });
    if (!error) return { ok: true };
    console.error('[category-request] resend error:', error);
  }

  const form = new FormData();
  form.set('category', entry.name);
  form.set('note', entry.note || '(none)');
  form.set('reply_email', entry.email || '(none left)');
  form.set('_subject', `Prism category request: ${entry.name}`);
  form.set('_captcha', 'false');
  form.set('_template', 'box');
  if (entry.email) form.set('_replyto', entry.email);

  const referer = origin.endsWith('/') ? origin : `${origin}/`;
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Origin: origin,
        Referer: referer,
      },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (String((data as { success?: string }).success) === 'true') return { ok: true };
    const message =
      typeof (data as { message?: string }).message === 'string'
        ? (data as { message: string }).message
        : 'Email was not accepted.';
    return { ok: false, message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Email failed.' };
  }
}
