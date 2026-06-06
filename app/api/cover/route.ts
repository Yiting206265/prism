import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { title, abstract } = await request.json() as { title?: string; abstract?: string };

    if (!title || !abstract) {
      return new Response('Missing title or abstract', { status: 400 });
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

    // Step 2: Cloudflare Workers AI → FLUX Schnell image
    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: visualPrompt, num_steps: 4, width: 768, height: 1024 }),
      }
    );

    if (!cfRes.ok) {
      const err = await cfRes.text();
      console.error('[cover] CF AI error:', err);
      return new Response(err, { status: cfRes.status });
    }

    const cfData = await cfRes.json();
    const base64 = cfData?.result?.image as string | undefined;

    if (!base64) {
      return new Response('No image returned from CF AI', { status: 502 });
    }

    const buffer = Buffer.from(base64, 'base64');

    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('[cover] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(message, { status: 500 });
  }
}
