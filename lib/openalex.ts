import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = process.env.VERCEL
  ? join('/tmp', 'prism-openalex')
  : join(process.cwd(), '.cache', 'openalex');

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Prism (https://prismdailyarxiv.com)',
};

export interface CollaboratorLookup {
  author: string;
  collaborators: string[];
}

function nameWords(words: string[]): string[] {
  if (words.length <= 2) return words;
  if (/^[A-Za-z]\.?$/.test(words[1] || '')) return words.slice(0, 3);
  return words.slice(0, 2);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function cachePath(name: string): string {
  const key = createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 20);
  return join(CACHE_DIR, `v2-${todayUTC()}-${key}.json`);
}

function readCached(name: string): CollaboratorLookup | null {
  try {
    const path = cachePath(name);
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, 'utf8')) as CollaboratorLookup;
    if (!data?.author || !Array.isArray(data.collaborators)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCached(name: string, result: CollaboratorLookup): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(name), JSON.stringify(result));
}

function lastWord(name: string): string {
  return name.trim().split(/\s+/).pop()?.replace(/[^A-Za-z-]/g, '').toLowerCase() ?? '';
}

function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0]?.replace(/[^A-Za-z-]/g, '').toLowerCase() ?? '';
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j - 1], row[j]) + 1;
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openAlex(path: string): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.openalex.org${path}`, {
        headers: HEADERS,
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        lastError = new Error(`OpenAlex ${res.status}`);
        await wait(500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
      return res.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('OpenAlex request failed');
      if (attempt === 2) break;
      await wait(500 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('OpenAlex request failed');
}

function asName(part: string): string | null {
  const words = nameWords(part.split(/\s+/).filter(Boolean));
  if (words.length < 2 || words.length > 4) return null;
  if (words.some((word) => word.length < 2 || /\d/.test(word))) return null;
  return words.join(' ');
}

function pieces(text: string): string[] {
  return text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
}

export function lookupNames(expertise: string, people: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | null) => {
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  // The collaborators box is the explicit list. Expertise may be
  // "topic, Name" or "Name, topic", so every comma-separated piece is tried.
  for (const part of pieces(people)) add(asName(part));
  for (const part of pieces(expertise)) add(asName(part));
  return names.slice(0, 4);
}

function firstNameClose(candidate: string, wanted: string): boolean {
  if (!candidate || !wanted) return false;
  if (candidate === wanted || editDistance(candidate, wanted) <= 1) return true;
  const [shorter, longer] = candidate.length <= wanted.length ? [candidate, wanted] : [wanted, candidate];
  return longer.startsWith(shorter) && longer.length - shorter.length <= 3;
}

export async function findCollaborators(name: string): Promise<CollaboratorLookup | null> {
  if (!name) return null;
  const cached = readCached(name);
  if (cached) return cached;

  const wantedLast = lastWord(name);
  const wantedFirst = firstWord(name);
  const queries = [name, wantedLast].filter((query, index, all) => query && all.indexOf(query) === index);
  const settled = await Promise.allSettled(queries.map((query) => (
    openAlex(`/authors?search=${encodeURIComponent(query)}&per-page=25`) as Promise<{
      results?: { id?: string; display_name?: string; works_count?: number }[];
    }>
  )));
  const lists = settled.flatMap((item) => item.status === 'fulfilled' ? [item.value] : []);
  if (!lists.length) {
    const rejected = settled.find((item) => item.status === 'rejected');
    const reason = rejected && rejected.status === 'rejected' ? rejected.reason : null;
    throw reason instanceof Error ? reason : new Error('OpenAlex request failed');
  }
  const seen = new Set<string>();
  const match = lists
    .flatMap((list) => list.results ?? [])
    .filter((author) => {
      if (!author.id || !author.display_name || seen.has(author.id)) return false;
      seen.add(author.id);
      if (lastWord(author.display_name) !== wantedLast) return false;
      return firstNameClose(firstWord(author.display_name), wantedFirst);
    })
    .sort((a, b) => (b.works_count ?? 0) - (a.works_count ?? 0))[0];
  if (!match?.id || !match.display_name) return null;

  const authorId = match.id.split('/').pop();
  const grouped = await openAlex(
    `/works?filter=authorships.author.id:${authorId}&group_by=authorships.author.id&per-page=10`
  ) as { group_by?: { key?: string; key_display_name?: string }[] };

  const collaborators = (grouped.group_by ?? [])
    .filter((row) => row.key && row.key !== match.id && row.key_display_name)
    .map((row) => row.key_display_name!.replace(/\s+/g, ' ').trim())
    .filter((display) => display.split(' ').length >= 2 && lastWord(display) !== wantedLast)
    .slice(0, 6);

  const result = { author: match.display_name, collaborators };
  if (collaborators.length) writeCached(name, result);
  return result;
}

export async function findListedCollaborators(expertise: string, people: string): Promise<CollaboratorLookup | null> {
  const names = lookupNames(expertise, people);
  if (!names.length) return null;
  const collaborators: string[] = [];
  const authors: string[] = [];
  const seen = new Set(names.flatMap((name) => [name.toLowerCase(), lastWord(name)]));
  let failure: Error | null = null;
  let reached = 0;
  for (const name of names) {
    let found: CollaboratorLookup | null = null;
    try {
      found = await findCollaborators(name);
      reached += 1;
    } catch (error) {
      failure = error instanceof Error ? error : new Error('OpenAlex request failed');
      continue;
    }
    if (!found?.collaborators.length) continue;
    authors.push(found.author);
    for (const collaborator of found.collaborators) {
      const key = collaborator.toLowerCase();
      if (seen.has(key) || seen.has(lastWord(collaborator))) continue;
      seen.add(key);
      seen.add(lastWord(collaborator));
      collaborators.push(collaborator);
      if (collaborators.length >= 6) break;
    }
    if (collaborators.length >= 6) break;
  }
  if (!collaborators.length) {
    if (failure && reached === 0) throw failure;
    return { author: names.join(', '), collaborators: [] };
  }
  return { author: authors.join(' and '), collaborators };
}
