export type ProviderName = 'arxiv' | 'pubmed';

export interface CategoryDef {
  id: string;
  label: string;
  group: string;
  provider: ProviderName;
  // PubMed esearch `term`. Unused for arxiv categories (their id doubles
  // as the arXiv category code, e.g. 'cs.AI').
  query?: string;
}

export const CATEGORIES: CategoryDef[] = [
  // AI & ML
  { id: 'cs.AI', label: 'cs.AI', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.LG', label: 'cs.LG', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.CV', label: 'cs.CV', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.CL', label: 'cs.CL', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.RO', label: 'cs.RO', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.NE', label: 'cs.NE', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.IR', label: 'cs.IR', group: 'AI & ML', provider: 'arxiv' },
  { id: 'stat.ML', label: 'stat.ML', group: 'AI & ML', provider: 'arxiv' },

  // Physics
  { id: 'quant-ph', label: 'quant-ph', group: 'Physics', provider: 'arxiv' },
  { id: 'cond-mat.mes-hall', label: 'cond-mat', group: 'Physics', provider: 'arxiv' },
  { id: 'hep-th', label: 'hep-th', group: 'Physics', provider: 'arxiv' },
  { id: 'astro-ph.GA', label: 'astro-ph', group: 'Physics', provider: 'arxiv' },
  { id: 'physics.optics', label: 'optics', group: 'Physics', provider: 'arxiv' },

  // Biology
  { id: 'q-bio.NC', label: 'q-bio.NC', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.GN', label: 'q-bio.GN', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.BM', label: 'q-bio.BM', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.QM', label: 'q-bio.QM', group: 'Biology', provider: 'arxiv' },

  // Medical (PubMed) — added in Task 4; kept here as the final registry
  // shape so this file only needs one edit across the whole plan.
  { id: 'med.ONC', label: 'Oncology', group: 'Medical', provider: 'pubmed', query: 'cancer[Majr] OR neoplasms[Majr]' },
  { id: 'med.CARD', label: 'Cardiology', group: 'Medical', provider: 'pubmed', query: 'cardiovascular diseases[Majr]' },
  { id: 'med.NEURO', label: 'Neurology', group: 'Medical', provider: 'pubmed', query: 'nervous system diseases[Majr]' },
  { id: 'med.ID', label: 'Infectious Disease', group: 'Medical', provider: 'pubmed', query: 'communicable diseases[Majr]' },
  { id: 'med.IMMUNO', label: 'Immunology', group: 'Medical', provider: 'pubmed', query: 'immune system diseases[Majr]' },

  // Math
  { id: 'math.ST', label: 'math.ST', group: 'Math', provider: 'arxiv' },
  { id: 'math.OC', label: 'math.OC', group: 'Math', provider: 'arxiv' },
  { id: 'math.CO', label: 'math.CO', group: 'Math', provider: 'arxiv' },
  { id: 'math.PR', label: 'math.PR', group: 'Math', provider: 'arxiv' },

  // Finance
  { id: 'q-fin.TR', label: 'q-fin.TR', group: 'Finance', provider: 'arxiv' },
  { id: 'q-fin.PM', label: 'q-fin.PM', group: 'Finance', provider: 'arxiv' },
  { id: 'q-fin.RM', label: 'q-fin.RM', group: 'Finance', provider: 'arxiv' },
];

// Pacing for the date-picker's per-category count sweep (PapersClient.tsx).
// arXiv's search API rate-limits to ~1 req/3s (verified while building the
// date picker). NCBI's public E-utilities limit is 3 req/sec unauthenticated
// — 400ms/category stays safely under that.
export const SWEEP_SPACING_MS: Record<ProviderName, number> = {
  arxiv: 3500,
  pubmed: 400,
};

export function getCategory(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function categoryLabels(): Record<string, string> {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
}

export interface CategoryGroup {
  label: string;
  categories: CategoryDef[];
}

export function categoryGroups(): CategoryGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, CategoryDef[]>();
  for (const cat of CATEGORIES) {
    if (!byGroup.has(cat.group)) {
      byGroup.set(cat.group, []);
      order.push(cat.group);
    }
    byGroup.get(cat.group)!.push(cat);
  }
  return order.map((label) => ({ label, categories: byGroup.get(label)! }));
}
