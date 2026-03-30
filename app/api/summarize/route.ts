import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, abstract } = body as { title?: string; abstract?: string };

    if (!title || !abstract) {
      return new Response('Missing title or abstract', { status: 400 });
    }

    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 280,
      messages: [
        {
          role: 'user',
          content: `Summarize this research paper in exactly 3 concise sentences for a technical audience:
1. The core problem or gap being addressed.
2. The key method or approach used.
3. The main result or contribution.

Be specific and precise. Avoid generic phrases like "the authors propose" — lead with the substance.

Title: ${title}

Abstract: ${abstract}`,
        },
      ],
    });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              controller.enqueue(new TextEncoder().encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[summarize] error:', error);
    return new Response('Failed to generate summary', { status: 500 });
  }
}
