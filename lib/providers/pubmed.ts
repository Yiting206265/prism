import { XMLParser } from 'fast-xml-parser';
import { getCategory } from '@/lib/categories';
import { decodeXmlEntities } from '@/lib/xmlEntities';
import type { Paper, FeedResult, Provider } from './types';

// Same retry/timeout shape as lib/arxivFetch.ts (bounded attempt timeout +
// a couple of backoff retries), but NCBI's failure modes are independent
// of arXiv's, so this is its own small copy rather than a shared helper.
const RETRY_DELAYS_MS = [1000, 3000];
const ATTEMPT_TIMEOUT_MS = 25000;
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

async function fetchEutils(
  url: string,
  retries: number = RETRY_DELAYS_MS.length,
  cacheOptions: RequestInit = { cache: 'no-store' }
): Promise<string> {
  const delays = RETRY_DELAYS_MS.slice(0, retries);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Prism/1.0 (Research Discovery App; https://github.com)' },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        ...cacheOptions,
      });
      if (!response.ok) {
        throw new Error(`PubMed E-utilities returned ${response.status}`);
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function toSlashDate(dateStr: string): string {
  return dateStr.replace(/-/g, '/');
}

interface EsearchResponse {
  esearchresult?: { count?: string; idlist?: string[] };
}

interface PubmedAuthor {
  LastName?: string;
  ForeName?: string;
  CollectiveName?: string;
}

interface PubmedDateParts {
  Year?: string | number;
  Month?: string | number;
  Day?: string | number;
}

interface PubmedArticleXml {
  MedlineCitation: {
    PMID: number | string | { '#text': number | string };
    Article: {
      ArticleTitle: string | { '#text': string };
      Abstract?: { AbstractText?: (string | { '#text': string })[] };
      AuthorList?: { Author?: PubmedAuthor[] };
      // Electronic pub date — when present, this is the date the paper
      // actually became available (PubDate below is often a nominal
      // print-issue date that can even sit months in the future).
      ArticleDate?: PubmedDateParts | PubmedDateParts[];
      Journal?: { JournalIssue?: { PubDate?: PubmedDateParts } };
    };
  };
}

function textOf(value: string | { '#text': string | number } | number | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return String(value['#text'] ?? '');
}

const MONTH_NUM: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function monthToNum(month: string | number | undefined): string {
  if (month === undefined) return '01';
  const asNum = typeof month === 'number' ? month : parseInt(month, 10);
  if (!isNaN(asNum)) return String(asNum).padStart(2, '0');
  return MONTH_NUM[String(month).slice(0, 3).toLowerCase()] ?? '01';
}

function datePartsToISO(parts: PubmedDateParts | undefined): string | null {
  if (!parts?.Year) return null;
  const day = parts.Day !== undefined ? String(parts.Day).padStart(2, '0') : '01';
  return `${parts.Year}-${monthToNum(parts.Month)}-${day}`;
}

// The paper's real publication date, not the query window's end date —
// needed once the feed spans more than a single day (see PUBMED_WINDOW_DAYS).
function realPublishedISO(article: PubmedArticleXml, fallback: string): string {
  const articleDateRaw = article.MedlineCitation.Article.ArticleDate;
  const articleDate = Array.isArray(articleDateRaw) ? articleDateRaw[0] : articleDateRaw;
  const pubDate = article.MedlineCitation.Article.Journal?.JournalIssue?.PubDate;
  return datePartsToISO(articleDate) ?? datePartsToISO(pubDate) ?? fallback;
}

async function search(
  query: string,
  dateStr: string,
  start: number,
  maxResults: number,
  retries?: number,
  cacheOptions?: RequestInit
) {
  const slash = toSlashDate(dateStr);
  const url =
    `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}` +
    `&datetype=pdat&mindate=${slash}&maxdate=${slash}&sort=pub_date` +
    `&retstart=${start}&retmax=${maxResults}&retmode=json`;

  const body = await fetchEutils(url, retries, cacheOptions);
  const parsed: EsearchResponse = JSON.parse(body);
  const total = parseInt(parsed.esearchresult?.count ?? '0', 10) || 0;
  const idlist = parsed.esearchresult?.idlist ?? [];
  return { total, idlist };
}

async function fetchArticles(ids: string[], retries?: number): Promise<Map<string, PubmedArticleXml>> {
  if (ids.length === 0) return new Map();

  const url = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=abstract&retmode=xml`;
  let xml = await fetchEutils(url, retries);
  // Strip inline formatting tags before parsing — see Global Constraints
  // for why (otherwise fast-xml-parser turns a plain-text field into a
  // nested object and scrambles word order when reassembled).
  xml = xml.replace(/<\/?(i|b|sup|sub|u)>/g, '');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['PubmedArticle', 'Author', 'AbstractText'].includes(name),
  });

  const result = parser.parse(xml);
  const articles: PubmedArticleXml[] = result?.PubmedArticleSet?.PubmedArticle ?? [];

  const byId = new Map<string, PubmedArticleXml>();
  for (const article of articles) {
    const pmid = textOf(article.MedlineCitation.PMID);
    if (pmid) byId.set(pmid, article);
  }
  return byId;
}

function toPaper(pmid: string, article: PubmedArticleXml, index: number, category: string, dateStr: string): Paper {
  const title = decodeXmlEntities(textOf(article.MedlineCitation.Article.ArticleTitle));

  const abstractSections = article.MedlineCitation.Article.Abstract?.AbstractText ?? [];
  const abstract = decodeXmlEntities(abstractSections.map((s) => textOf(s)).join(' '));

  const authorEntries = article.MedlineCitation.Article.AuthorList?.Author ?? [];
  const authors = authorEntries
    .map((a) => decodeXmlEntities(a.CollectiveName || [a.ForeName, a.LastName].filter(Boolean).join(' ')))
    .filter(Boolean);

  const published = `${realPublishedISO(article, dateStr)}T00:00:00Z`;

  return {
    id: pmid,
    index,
    title,
    authors,
    abstract,
    published,
    updated: published,
    categories: [category],
    absUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    source: 'pubmed',
  };
}

async function fetchFeed(
  category: string,
  date: string | null,
  start: number,
  maxResults: number,
  retries?: number
): Promise<FeedResult> {
  const query = getCategory(category)?.query;
  if (!query) throw new Error(`Unknown PubMed category: ${category}`);

  const dateStr = date ?? todayISO();
  const { total, idlist } = await search(query, dateStr, start, maxResults, retries);
  if (idlist.length === 0) return { papers: [], total };

  const articlesById = await fetchArticles(idlist, retries);
  const papers = idlist
    .map((pmid, i) => {
      const article = articlesById.get(pmid);
      return article ? toPaper(pmid, article, start + i + 1, category, dateStr) : null;
    })
    .filter((p): p is Paper => p !== null);

  return { papers, total };
}

async function fetchCount(category: string): Promise<number> {
  const query = getCategory(category)?.query;
  if (!query) return 0;
  try {
    const { total } = await search(query, todayISO(), 0, 0, undefined, { next: { revalidate: 300 } });
    return total;
  } catch {
    return 0;
  }
}

export const pubmedProvider: Provider = { fetchFeed, fetchCount };
