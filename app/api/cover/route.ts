import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = process.env.VERCEL ? join('/tmp', 'covers') : join(process.cwd(), '.cache', 'covers');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCacheKey(title: string, model: string): string {
  return createHash('sha256').update(`${model}:${title}`).digest('hex').slice(0, 32);
}

function readCache(key: string): { buffer: Buffer; contentType: string } | null {
  const metaPath = join(CACHE_DIR, `${key}.json`);
  const dataPath = join(CACHE_DIR, `${key}.bin`);
  if (!existsSync(metaPath) || !existsSync(dataPath)) return null;
  const age = Date.now() - statSync(dataPath).mtimeMs;
  if (age > CACHE_TTL_MS) return null;
  const { contentType } = JSON.parse(readFileSync(metaPath, 'utf8'));
  return { buffer: readFileSync(dataPath), contentType };
}

function writeCache(key: string, buffer: Buffer, contentType: string): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, `${key}.bin`), buffer);
  writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify({ contentType }));
}

// Plain solid black — used whenever real image generation isn't available
// (rate limit, no backend configured). No pattern: the .cover-fallback CSS
// theme (pure black card, white text) already signals this is deliberate.
function makeSvgCover(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768">
  <rect width="512" height="768" fill="#000000"/>
</svg>`;
}

export async function POST(request: NextRequest) {
  try {
    const ALLOWED_MODELS: Record<string, string> = {
      'flux-1-schnell':               '@cf/black-forest-labs/flux-1-schnell',
      'stable-diffusion-xl-base-1.0': '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      'stable-diffusion-xl-lightning':'@cf/bytedance/stable-diffusion-xl-lightning',
      'dreamshaper-8-lcm':            '@cf/lykon/dreamshaper-8-lcm',
    };

    const { title, abstract, model: modelKey = 'flux-1-schnell' } =
      await request.json() as { title?: string; abstract?: string; model?: string };

    if (!title || !abstract) {
      return new Response('Missing title or abstract', { status: 400 });
    }

    const cfModel = ALLOWED_MODELS[modelKey] ?? ALLOWED_MODELS['flux-1-schnell'];
    const useCloudflare = !!process.env.CF_ACCOUNT_ID && !!process.env.CF_API_TOKEN;

    // Return cached image if available
    const cacheKey = getCacheKey(title, modelKey);
    const cached = readCache(cacheKey);
    if (cached) {
      return new Response(new Uint8Array(cached.buffer), {
        headers: { 'Content-Type': cached.contentType, 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'HIT' },
      });
    }

    // Step 1: Groq → evocative visual prompt. Any failure here (rate limit,
    // outage) just falls back to the raw title instead of failing the whole
    // request — image generation below still has its own SVG fallback too.
    let visualPrompt = title;
    try {
      const promptRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `You are an editorial illustrator creating ONE minimalist concept image for a research paper. It will be shown faded and tinted as a background texture behind the paper's real title, which is rendered separately as HTML text — so the image itself must contain ZERO text, letters, numbers, words, logos, or typography of any kind.

Write an image generation prompt as one flowing paragraph (80-110 words):
1. SUBJECT: identify the single clearest visual metaphor for this paper's central idea — name the exact phenomenon, object, or process from the abstract. Render it as one clean subject with at most 1-2 supporting elements. Adapt the visual style to the field (biological, computational, physical, mathematical, social, etc).
2. STYLE: minimalist editorial illustration — flat clean shapes, generous negative space, a muted limited color palette, soft even lighting. Simple enough to work as a faded background, not a busy poster.
3. End the prompt explicitly with: "no text, no letters, no numbers, no words, no logos, no watermark"

Be specific to THIS paper's actual subject — not a generic tech/science cliché. No equations, no axis labels, no charts.

Title: ${title}
Abstract: ${abstract.slice(0, 600)}

Output only the image generation prompt, as one clean paragraph.`,
          }],
        }),
      });

      if (promptRes.ok) {
        const promptData = await promptRes.json();
        visualPrompt = promptData.choices?.[0]?.message?.content?.trim() ?? title;
      } else {
        console.warn('[cover] Groq unavailable, using raw title as prompt:', promptRes.status);
      }
    } catch (e) {
      console.warn('[cover] Groq error, using raw title as prompt:', e instanceof Error ? e.message : e);
    }

    // Step 2: Generate image — Cloudflare Workers AI first (best quality/speed
    // when quota is available), then Pollinations/HF/black cover in order.
    let buffer: Buffer | null = null;

    if (useCloudflare) {
      try {
        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/${cfModel}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: visualPrompt }),
          }
        );

        if (cfRes.ok) {
          const contentType = cfRes.headers.get('content-type') ?? '';
          if (contentType.includes('image')) {
            buffer = Buffer.from(await cfRes.arrayBuffer());
          } else {
            const cfData = await cfRes.json();
            const base64 = cfData?.result?.image as string | undefined;
            if (base64) buffer = Buffer.from(base64, 'base64');
          }
        } else {
          const err = await cfRes.text();
          console.warn('[cover] CF AI unavailable, falling back:', err.slice(0, 120));
        }
      } catch (e) {
        console.warn('[cover] CF AI error, falling back:', e instanceof Error ? e.message : e);
      }
    }

    // Fallback 1: Pollinations.ai — free Flux image generation, no API key
    // required, no daily quota (just a soft per-request rate limit).
    if (!buffer) {
      try {
        const pollinationsUrl =
          `https://image.pollinations.ai/prompt/${encodeURIComponent(visualPrompt.slice(0, 500))}` +
          `?width=1024&height=768&model=flux&nologo=true&safe=true`;
        const polRes = await fetch(pollinationsUrl, { signal: AbortSignal.timeout(30000) });
        if (polRes.ok) {
          buffer = Buffer.from(await polRes.arrayBuffer());
        } else {
          console.warn('[cover] Pollinations unavailable:', polRes.status);
        }
      } catch (e) {
        console.warn('[cover] Pollinations error:', e instanceof Error ? e.message : e);
      }
    }

    // Fallback 2: Hugging Face Inference API (FLUX.1-schnell)
    if (!buffer && process.env.HF_TOKEN) {
      try {
        const hfRes = await fetch(
          'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.HF_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ inputs: visualPrompt.slice(0, 500), parameters: { width: 512, height: 768 } }),
            signal: AbortSignal.timeout(60000),
          }
        );
        if (hfRes.ok) {
          buffer = Buffer.from(await hfRes.arrayBuffer());
        } else {
          console.warn('[cover] HF unavailable:', hfRes.status);
        }
      } catch (e) {
        console.warn('[cover] HF error:', e instanceof Error ? e.message : e);
      }
    }

    // Fallback 3: plain black cover
    if (!buffer) {
      const svg = makeSvgCover();
      const svgBuffer = Buffer.from(svg);
      writeCache(cacheKey, svgBuffer, 'image/svg+xml');
      return new Response(svgBuffer, {
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' },
      });
    }

    writeCache(cacheKey, buffer, 'image/png');
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'MISS' },
    });
  } catch (error) {
    console.error('[cover] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(message, { status: 500 });
  }
}
