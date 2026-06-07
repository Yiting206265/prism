import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = join(process.cwd(), '.cache', 'covers');
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

function makeSvgCover(title: string): string {
  // Hash title to pick a palette
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (Math.imul(31, h) + title.charCodeAt(i)) | 0;
  const palettes = [
    ['#0f2027','#203a43','#2c5364'],
    ['#1a1a2e','#16213e','#0f3460'],
    ['#0d0d0d','#1a0533','#2d1b69'],
    ['#0f0c29','#302b63','#24243e'],
    ['#000428','#004e92','#1a6b8a'],
    ['#0a3d62','#1e5f74','#0e4d92'],
    ['#1b2838','#2a475e','#1b4965'],
    ['#1a1a1a','#2d4739','#1b6b4e'],
  ];
  const [c1, c2, c3] = palettes[Math.abs(h) % palettes.length];
  const words = title.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 18) { lines.push(line.trim()); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  const maxLines = lines.slice(0, 5);
  const midY = 384;
  const lineH = 28;
  const startY = midY - ((maxLines.length - 1) * lineH) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="50%" stop-color="${c2}"/>
      <stop offset="100%" stop-color="${c3}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="512" height="768" fill="url(#bg)"/>
  <rect x="0" y="0" width="512" height="4" fill="white" opacity="0.6"/>
  <rect x="0" y="764" width="512" height="4" fill="white" opacity="0.6"/>
  <circle cx="256" cy="${midY}" r="160" fill="none" stroke="white" stroke-width="0.5" opacity="0.15"/>
  <circle cx="256" cy="${midY}" r="120" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/>
  <circle cx="256" cy="${midY}" r="200" fill="white" opacity="0.04" filter="url(#glow)"/>
  <text x="256" y="60" font-family="Georgia,serif" font-size="11" fill="white" opacity="0.7" text-anchor="middle" letter-spacing="4">PRISM · RESEARCH</text>
  <line x1="80" y1="72" x2="432" y2="72" stroke="white" stroke-width="0.5" opacity="0.3"/>
  ${maxLines.map((l, i) => `<text x="256" y="${startY + i * lineH}" font-family="Georgia,serif" font-size="22" font-weight="bold" fill="white" text-anchor="middle" opacity="0.95">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text>`).join('\n  ')}
  <line x1="80" y1="696" x2="432" y2="696" stroke="white" stroke-width="0.5" opacity="0.3"/>
  <text x="256" y="720" font-family="Georgia,serif" font-size="10" fill="white" opacity="0.5" text-anchor="middle" letter-spacing="2">arxiv preprint</text>
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
      return new Response(cached.buffer, {
        headers: { 'Content-Type': cached.contentType, 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'HIT' },
      });
    }

    // Step 1: Groq → evocative visual prompt
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
          content: `You are a scientific cover art director designing a journal cover like Nature or Science. Write an image generation prompt as one flowing paragraph (120-150 words) that describes BOTH the visual scene AND the cover text layout.

The prompt must include:
1. SCENE: a vivid, paper-specific central image — name the exact phenomenon, object, or concept from the paper. Add 2-3 supporting visual elements drawn from the abstract. Adapt the visual style to the field (e.g. biological, computational, physical, mathematical).
2. TEXT OVERLAY: describe specific short text embedded in the image like a real magazine cover — a bold title at the top (2-5 words capturing the discovery), a short evocative tagline below it, and a small label or caption at the bottom corner.
3. STYLE: end with quality tags — "cinematic, dramatic lighting, volumetric glow, ultra-detailed, premium editorial design, Nature/Science journal cover aesthetic, 8k"

Be specific to THIS paper. No equations, no axis labels.

Title: ${title}
Abstract: ${abstract.slice(0, 600)}

Output only the image generation prompt, as one clean paragraph.`,
        }],
      }),
    });

    if (!promptRes.ok) {
      throw new Error(`Groq error: ${promptRes.status}`);
    }

    const promptData = await promptRes.json();
    const visualPrompt = promptData.choices?.[0]?.message?.content?.trim() ?? title;

    // Step 2: Generate image — Cloudflare Workers AI with Pollinations fallback
    let buffer: Buffer | null = null;

    if (useCloudflare) {
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
        console.warn('[cover] CF AI unavailable, falling back to Pollinations:', err.slice(0, 120));
      }
    }

    // Fallback 1: Hugging Face Inference API (FLUX.1-schnell)
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

    // Fallback 2: styled SVG cover using the paper title
    if (!buffer) {
      const svg = makeSvgCover(title);
      const svgBuffer = Buffer.from(svg);
      writeCache(cacheKey, svgBuffer, 'image/svg+xml');
      return new Response(svgBuffer, {
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' },
      });
    }

    writeCache(cacheKey, buffer, 'image/png');
    return new Response(buffer, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'MISS' },
    });
  } catch (error) {
    console.error('[cover] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(message, { status: 500 });
  }
}
