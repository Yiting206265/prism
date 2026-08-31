import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text } = body as { text?: string };

    if (!text) {
      return new Response('Missing text', { status: 400 });
    }

    const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'canopylabs/orpheus-v1-english',
        voice: 'hannah',
        input: text,
        response_format: 'wav',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[speak] Groq error:', err);
      return new Response(err, { status: response.status });
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-cache, no-store',
      },
    });
  } catch (error) {
    console.error('[speak] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(message, { status: 500 });
  }
}
