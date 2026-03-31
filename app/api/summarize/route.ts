import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, abstract } = body as { title?: string; abstract?: string };

    if (!title || !abstract) {
      return new Response('Missing title or abstract', { status: 400 });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 280,
        stream: true,
        messages: [
          {
            role: 'user',
            content: `Summarize this research paper in exactly 3 concise sentences. Cover: (1) the core problem, (2) the method used, (3) the main result. Output only the 3 sentences — no intro phrase, no numbering, no preamble.

Title: ${title}

Abstract: ${abstract}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[summarize] Groq error:', err);
      return new Response(err, { status: response.status });
    }

    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
              const trimmed = line.replace(/^data: /, '').trim();
              if (!trimmed || trimmed === '[DONE]') continue;
              try {
                const json = JSON.parse(trimmed);
                const text = json.choices?.[0]?.delta?.content;
                if (text) controller.enqueue(new TextEncoder().encode(text));
              } catch {}
            }
          }
          controller.close();
        } catch (err) {
          console.error('[summarize] stream error:', err);
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
      },
    });
  } catch (error) {
    console.error('[summarize] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(message, { status: 500 });
  }
}
