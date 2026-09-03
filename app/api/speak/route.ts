import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CF_MODEL = '@cf/myshell-ai/melotts';
const MAX_CHARS = 700;

function clipForSpeech(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= MAX_CHARS) return cleaned;
  const slice = cleaned.slice(0, MAX_CHARS);
  const lastStop = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! ')
  );
  return (lastStop > 200 ? slice.slice(0, lastStop + 1) : slice).trim();
}

function audioFromCfPayload(data: unknown): Buffer | null {
  const rec = data as Record<string, unknown> | null;
  const result = rec?.result as Record<string, unknown> | string | undefined;
  const b64 =
    (typeof result === 'object' && result && typeof result.audio === 'string' && result.audio) ||
    (typeof result === 'string' && result) ||
    (typeof rec?.audio === 'string' && rec.audio) ||
    '';
  if (!b64) return null;
  return Buffer.from(b64, 'base64');
}

async function runMelotts(
  accountId: string,
  token: string,
  prompt: string
): Promise<{ buffer: Buffer; contentType: string } | { error: string; status: number }> {
  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, lang: 'en' }),
      signal: AbortSignal.timeout(25000),
    }
  );

  if (!cfRes.ok) {
    const err = await cfRes.text();
    return { error: err.slice(0, 400), status: cfRes.status };
  }

  const contentType = cfRes.headers.get('content-type') ?? '';
  if (contentType.includes('audio/')) {
    return { buffer: Buffer.from(await cfRes.arrayBuffer()), contentType };
  }

  const data = await cfRes.json();
  const buffer = audioFromCfPayload(data);
  if (!buffer) return { error: 'empty audio', status: 502 };
  const isWav = buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'RIFF';
  return { buffer, contentType: isWav ? 'audio/wav' : 'audio/mpeg' };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text } = body as { text?: string };

    if (!text?.trim()) {
      return new Response('Missing text', { status: 400 });
    }

    const accountId = process.env.CF_ACCOUNT_ID;
    const token = process.env.CF_API_TOKEN;
    if (!accountId || !token) {
      return new Response('Speech is not configured', { status: 503 });
    }

    const prompt = clipForSpeech(text);
    let lastError = 'Could not generate speech';
    let lastStatus = 502;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
      const result = await runMelotts(accountId, token, prompt);
      if ('buffer' in result) {
        return new Response(new Uint8Array(result.buffer), {
          headers: {
            'Content-Type': result.contentType,
            'Cache-Control': 'no-cache, no-store',
          },
        });
      }
      lastError = result.error;
      lastStatus = result.status;
      console.warn('[speak] MeloTTS attempt failed', attempt + 1, result.status, result.error);
      if (result.status > 0 && result.status < 500 && result.status !== 429) break;
    }

    console.error('[speak] Cloudflare TTS failed:', lastStatus, lastError);
    return new Response('Could not generate speech', { status: 502 });
  } catch (error) {
    console.error('[speak] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(message, { status: 500 });
  }
}
