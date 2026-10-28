import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CATEGORIES, SWEEP_SPACING_MS } from '@/lib/categories';
import { searchArxivPapers } from '@/lib/providers/arxiv';
import type { Paper } from '@/lib/providers/types';

export interface RecommendProfile {
  expertise: string;
  people: string;
  follow: string;
}

export interface RecommendResult {
  day: string;
  papers: Paper[];
  reasons: Record<string, string>;
  cached: boolean;
}

const CACHE_DIR = process.env.VERCEL
  ? join('/tmp', 'prism-recommend')
  : join(process.cwd(), '.cache', 'recommend');

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function readProfile(body: unknown): RecommendProfile | null {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const expertise = clean(record.expertise, 800);
  if (expertise.length < 8) return null;
  return {
    expertise,
    people: clean(record.people, 400),
    follow: clean(record.follow, 400),
  };
}

function profileKey(profile: RecommendProfile): string {
  const text = [profile.expertise, profile.people, profile.follow]
    .join('\n')
    .toLowerCase();
  return createHash('sha256').update(text).digest('hex').slice(0, 20);
}

function cachePath(key: string): string {
  return join(CACHE_DIR, `v6-${todayUTC()}-${key}.json`);
}

function readCache(key: string): RecommendResult | null {
  try {
    const path = cachePath(key);
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, 'utf8')) as RecommendResult;
    if (!data || data.day !== todayUTC() || !Array.isArray(data.papers)) return null;
    return { ...data, cached: true };
  } catch {
    return null;
  }
}

function writeCache(key: string, result: RecommendResult): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(key), JSON.stringify({ ...result, cached: false }));
}

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'from', 'by', 'at', 'as',
  'is', 'are', 'be', 'this', 'that', 'these', 'those', 'into', 'over', 'than', 'then', 'also',
  'not', 'but', 'we', 'our', 'your', 'you', 'their', 'its', 'it', 'about', 'using', 'use', 'used',
  'via', 'across', 'within', 'between', 'such', 'more', 'most', 'other', 'some', 'any', 'can',
  'may', 'how', 'what', 'when', 'where', 'who', 'which', 'while', 'during', 'after', 'before',
  'new', 'novel', 'based', 'paper', 'papers', 'study', 'studies', 'research', 'work', 'working',
  'interested', 'interest', 'field', 'area', 'focus', 'focused', 'recent', 'today', 'daily',
  'please', 'prefer', 'skip', 'like', 'just', 'want', 'looking', 'topic', 'topics', 'domain',
  'expertise', 'group', 'people', 'author', 'authors',
]);

const GENERIC = new Set([
  'model', 'models', 'learning', 'data', 'system', 'systems', 'method', 'methods', 'analysis',
  'network', 'networks', 'approach', 'result', 'results', 'large', 'deep', 'neural', 'time',
  'real', 'human', 'humans', 'computer', 'computing', 'science', 'scientific', 'information',
  'process', 'processing', 'application', 'applications', 'problem', 'problems', 'task', 'tasks',
  'general', 'simple', 'complex', 'world', 'state', 'high', 'low', 'small',
]);

// Topics the home page does not list as their own category. Used only to
// prefer a paper that already matches the words, never to replace the search.
const TOPIC_CATEGORIES: { cats: string[]; words: string[] }[] = [
  { cats: ['astro-ph.EP'], words: ['exoplanet', 'exoplanets', 'exomoon', 'exomoons', 'protoplanetary', 'planetary system'] },
  { cats: ['astro-ph.GA'], words: ['galaxy', 'galaxies', 'milky way', 'galactic'] },
  { cats: ['astro-ph.CO'], words: ['cosmology', 'dark matter', 'dark energy'] },
  { cats: ['astro-ph.SR'], words: ['stellar', 'supernova', 'supernovae'] },
  { cats: ['cs.CL'], words: ['language model', 'language models', 'natural language'] },
  { cats: ['cs.CV'], words: ['computer vision', 'object detection', 'image segmentation'] },
  { cats: ['cs.LG', 'stat.ML'], words: ['machine learning', 'deep learning'] },
  { cats: ['cs.AI'], words: ['artificial intelligence'] },
  { cats: ['q-bio.BM'], words: ['protein folding', 'proteins', 'biomolecule'] },
];

interface Term {
  text: string;
  weight: number;
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function variants(term: string): string[] {
  const out = new Set([term]);
  if (term.endsWith('ies') && term.length > 5) out.add(`${term.slice(0, -3)}y`);
  else if (term.endsWith('s') && !term.endsWith('ss') && term.length > 4) out.add(term.slice(0, -1));
  else if (term.length > 3) out.add(`${term}s`);
  return [...out];
}

function phraseVariants(phrase: string): string[] {
  const parts = phrase.split(' ');
  if (parts.length === 1) return variants(parts[0]);
  const head = parts.slice(0, -1).join(' ');
  return variants(parts[parts.length - 1]).map((last) => `${head} ${last}`);
}

interface Person {
  first: string;
  last: string;
  display: string;
}

const TOPIC_WORDS = new Set(
  TOPIC_CATEGORIES.flatMap((topic) => topic.words.flatMap((word) => word.split(' ')))
);

function splitParts(text: string): string[] {
  return text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
}

function titleWord(word: string): string {
  const clean = word.replace(/[^A-Za-z.'-]/g, '');
  if (!clean) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function isTopicWord(word: string): boolean {
  const lower = word.toLowerCase();
  return STOP.has(lower) || GENERIC.has(lower) || TOPIC_WORDS.has(lower);
}

function isName(part: string): boolean {
  const words = part.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Z][A-Za-z.'-]+$/.test(word));
}

function looksLikeLooseName(part: string): boolean {
  const words = part.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((word) => word.length >= 2 && !isTopicWord(word));
}

function toPerson(part: string): Person | null {
  const words = part.split(/\s+/).map(titleWord).filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  const last = words[words.length - 1].replace(/[^A-Za-z-]/g, '');
  const first = words.slice(0, -1).join(' ');
  if (last.length < 3 || !first) return null;
  return { first, last, display: `${first} ${last}` };
}

function parseInterest(profile: RecommendProfile): { people: Person[]; topics: Term[] } {
  const parts = splitParts(profile.expertise);
  const people: Person[] = [];
  const topicParts: string[] = [];
  parts.forEach((part) => {
    const person = (isName(part) || looksLikeLooseName(part)) ? toPerson(part) : null;
    if (person) people.push(person);
    else topicParts.push(part);
  });

  for (const part of splitParts(profile.people)) {
    const person = toPerson(part);
    if (person && (isName(part) || looksLikeLooseName(part))) people.push(person);
    else if (/^[A-Za-z][A-Za-z'-]{2,}$/.test(part) && !isTopicWord(part)) {
      const last = titleWord(part);
      people.push({ first: '', last, display: last });
    }
  }

  for (const part of splitParts(profile.follow)) {
    const person = isName(part) ? toPerson(part) : null;
    if (person) people.push(person);
    else if (part.length > 3) topicParts.push(part);
  }

  const seen = new Set<string>();
  const uniquePeople = people.filter((person) => {
    const key = person.last.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 7);

  const topics = topicParts.flatMap((part) => termsFrom(part).query).slice(0, 4);
  return { people: uniquePeople, topics };
}

function termsFrom(text: string): { query: Term[]; score: Term[] } {
  const raw = wordsOf(text);
  const bigrams: string[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const left = raw[i];
    const right = raw[i + 1];
    if (STOP.has(left) || STOP.has(right)) continue;
    if (left.length < 3 || right.length < 3) continue;
    bigrams.push(`${left} ${right}`);
  }
  const uniqueBigrams = [...new Set(bigrams)]
    .sort((a, b) => Math.max(...b.split(' ').map((w) => w.length)) - Math.max(...a.split(' ').map((w) => w.length)) || b.length - a.length)
    .slice(0, 3);

  const unigrams = [...new Set(raw.filter((word) => word.length > 3 && !STOP.has(word)))];
  const distinctive = unigrams.filter((word) => !GENERIC.has(word));
  const queryWords = uniqueBigrams.length
    ? []
    : (distinctive.length ? distinctive : unigrams).slice(0, 3);

  const query = [
    ...uniqueBigrams.map((text) => ({ text, weight: 3 })),
    ...queryWords.map((text) => ({ text, weight: 2 })),
  ];
  const covered = new Set(uniqueBigrams.flatMap((phrase) => phrase.split(' ')));
  const score = [
    ...query,
    ...distinctive
      .filter((word) => !covered.has(word) && !queryWords.includes(word))
      .slice(0, 4)
      .map((text) => ({ text, weight: 1 })),
  ];
  return { query, score };
}

function guessedCategories(text: string): Set<string> {
  const hay = text.toLowerCase();
  const cats = new Set<string>();
  for (const topic of TOPIC_CATEGORIES) {
    if (topic.words.some((word) => hay.includes(word))) {
      for (const cat of topic.cats) cats.add(cat);
    }
  }
  for (const cat of CATEGORIES) {
    if (cat.provider !== 'arxiv') continue;
    if (hay.includes(cat.name.toLowerCase()) || hay.includes(cat.id.toLowerCase())) cats.add(cat.id);
  }
  return cats;
}

function quoteTerm(term: string): string {
  const safe = term.replace(/["\\]/g, '').trim();
  return safe.includes(' ') ? `"${safe}"` : safe;
}

function dateWindow(daysBack: number): string {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const stamp = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '');
  return `submittedDate:[${stamp(start)}0000+TO+${stamp(end)}2359]`;
}

function countTerm(hay: string, term: string): number {
  const needle = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = hay.match(new RegExp(`(?:^|[^a-z0-9])${needle}(?=[^a-z0-9]|$)`, 'g'));
  return matches ? matches.length : 0;
}

function fieldHits(field: string, terms: Term[]): { score: number; matched: string[] } {
  const hay = field.toLowerCase();
  let score = 0;
  const matched: string[] = [];
  for (const term of terms) {
    const count = phraseVariants(term.text).reduce((sum, variant) => sum + countTerm(hay, variant), 0);
    if (!count) continue;
    score += term.weight * Math.min(count, 3);
    matched.push(term.text);
  }
  return { score, matched };
}

function authorHit(paper: Paper, people: Person[]): string | null {
  const hay = paper.authors.join(' ').toLowerCase();
  const found = people.find((person) => countTerm(hay, person.last.toLowerCase()));
  return found ? found.display : null;
}

interface Scored {
  paper: Paper;
  score: number;
  titleHits: string[];
  bodyHits: string[];
  author: string | null;
}

function scorePaper(paper: Paper, terms: Term[], people: Person[], cats: Set<string>): Scored | null {
  const primary = terms.filter((term) => term.weight >= 2);
  const extra = terms.filter((term) => term.weight < 2);
  const title = fieldHits(paper.title, primary);
  const body = fieldHits(paper.abstract, primary);
  const author = authorHit(paper, people);
  if (people.length && !author) return null;
  const matched = new Set([...title.matched, ...body.matched]);
  if (primary.length && !matched.size) return null;
  if (!matched.size && !author) return null;
  const coverage = matched.size > 1 ? 1 + 0.5 * (matched.size - 1) : 1;
  const bonus = fieldHits(`${paper.title} ${paper.abstract}`, extra).score;
  let score = (title.score * 4 + body.score) * coverage + bonus;
  if (author) score += 3;
  if ([...cats].some((cat) => paper.categories.includes(cat))) score += 1.5;
  if (score <= 0) return null;
  return { paper, score, titleHits: title.matched, bodyHits: body.matched, author };
}

function reasonFor(scored: Scored): string {
  const hits = (scored.titleHits.length ? scored.titleHits : scored.bodyHits).slice(0, 2);
  const quoted = hits.join(' and ');
  const about = scored.titleHits.length
    ? `mentions ${quoted} in the title`
    : hits.length
      ? `discusses ${quoted}`
      : '';
  if (scored.author && about) return `By ${scored.author}, and it ${about}.`;
  if (about) return `${about.charAt(0).toUpperCase()}${about.slice(1)}.`;
  return `By ${scored.author}.`;
}

function publishedMs(paper: Paper): number {
  const ms = Date.parse(paper.published);
  return Number.isNaN(ms) ? 0 : ms;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authorClause(person: Person): string {
  const last = person.last.replace(/[^A-Za-z-]/g, '');
  if (!last) return '';
  if (!person.first) return `au:${last}`;
  return `(au:${last}+OR+au:${quoteTerm(`${person.first} ${last}`)})`;
}

async function fetchMatches(topics: Term[], people: Person[], days: number): Promise<Paper[]> {
  const topicClauses = [...new Set(topics.flatMap((term) => (
    phraseVariants(term.text).map((variant) => {
      const quoted = quoteTerm(variant);
      return `(ti:${quoted}+OR+abs:${quoted})`;
    })
  )))].slice(0, 8);
  const authorClauses = people.map(authorClause).filter(Boolean);
  let body = '';
  if (topicClauses.length && authorClauses.length) {
    body = `(${authorClauses.join('+OR+')})+AND+(${topicClauses.join('+OR+')})`;
  } else if (topicClauses.length) {
    body = `(${topicClauses.join('+OR+')})`;
  } else if (authorClauses.length) {
    body = `(${authorClauses.join('+OR+')})`;
  }
  if (!body) return [];
  return searchArxivPapers(`${body}+AND+${dateWindow(days)}`, 50, 'submittedDate');
}

async function rankBySimilarity(profile: RecommendProfile): Promise<{ papers: Paper[]; reasons: Record<string, string> }> {
  const interest = parseInterest(profile);
  const terms = interest.topics;
  const cats = guessedCategories(interest.topics.map((term) => term.text).join(' '));
  if (!interest.topics.length && !interest.people.length) return { papers: [], reasons: {} };

  const byId = new Map<string, Paper>();
  const windows = interest.people.length ? [180, 365] : [14, 60, 120];
  let ranked: Scored[] = [];
  for (let i = 0; i < windows.length; i++) {
    if (i > 0) await sleep(SWEEP_SPACING_MS.arxiv);
    try {
      for (const paper of await fetchMatches(interest.topics, interest.people, windows[i])) {
        if (paper.id && !byId.has(paper.id)) byId.set(paper.id, paper);
      }
    } catch (error) {
      console.error('[recommend] search failed:', error instanceof Error ? error.message : error);
      if (!byId.size) throw error;
      break;
    }
    ranked = [...byId.values()]
      .map((paper) => scorePaper(paper, terms, interest.people, cats))
      .filter((item): item is Scored => item !== null)
      .sort((a, b) => publishedMs(b.paper) - publishedMs(a.paper) || b.score - a.score);
    if (ranked.length >= 30) break;
  }

  const chosen = ranked.slice(0, 30);
  return {
    papers: chosen.map((item) => item.paper),
    reasons: Object.fromEntries(chosen.map((item) => [item.paper.id, reasonFor(item)])),
  };
}


export async function recommend(profile: RecommendProfile): Promise<RecommendResult> {
  const key = profileKey(profile);
  const cached = readCache(key);
  if (cached) return cached;

  const day = todayUTC();
  const ranked = await rankBySimilarity(profile);
  if (!ranked.papers.length) {
    const empty: RecommendResult = { day, papers: [], reasons: {}, cached: false };
    writeCache(key, empty);
    return empty;
  }

  const result: RecommendResult = { day, papers: ranked.papers, reasons: ranked.reasons, cached: false };
  writeCache(key, result);
  return result;
}
