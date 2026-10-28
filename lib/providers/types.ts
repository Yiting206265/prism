export interface Paper {
  id: string;
  index: number;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  updated: string;
  categories: string[];
  // Only arXiv papers have a free PDF. PubMed papers link to the abstract
  // page only (see PaperCard.tsx).
  pdfUrl?: string;
  absUrl: string;
  source: 'arxiv' | 'pubmed';
}

export interface FeedResult {
  papers: Paper[];
  total: number;
}

export interface Provider {
  fetchFeed(
    category: string,
    date: string | null,
    start: number,
    maxResults: number,
    retries?: number
  ): Promise<FeedResult>;
  fetchCount(category: string): Promise<number>;
}
