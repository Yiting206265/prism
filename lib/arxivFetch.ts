// arXiv's search API (export.arxiv.org/api/query) is prone to transient
// 429/503s and multi-second stalls under normal load, unlike its RSS feed.
// Retry a couple of times with backoff, bounding each attempt so a stalled
// connection fails fast into a retry instead of hanging indefinitely.
const RETRY_DELAYS_MS = [1000, 3000];
const ATTEMPT_TIMEOUT_MS = 25000;

// `retries` lets a caller opt out of the backoff loop entirely (pass 0).
// This matters for callers that already space their own requests out to
// respect arXiv's rate limit (e.g. a per-category sweep): retrying inside
// a single call re-bursts requests within the same window a 429 just came
// from, which defeats the outer spacing and keeps re-triggering the limit.
export async function fetchArxivXml(url: string, retries: number = RETRY_DELAYS_MS.length): Promise<string> {
  const delays = RETRY_DELAYS_MS.slice(0, retries);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`arXiv query API returned ${response.status}`);
      }

      return await response.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < delays.length) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  throw lastError;
}
