export type ProviderName = 'arxiv' | 'pubmed';

export interface CategoryDef {
  id: string;
  label: string;
  name: string;
  group: string;
  provider: ProviderName;
  // PubMed esearch `term`. Unused for arxiv categories (their id doubles
  // as the arXiv category code, e.g. 'cs.AI').
  query?: string;
}

export const CATEGORIES: CategoryDef[] = [
  // AI & ML
  { id: 'cs.AI', label: 'cs.AI', name: 'Artificial Intelligence', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.LG', label: 'cs.LG', name: 'Machine Learning', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.CV', label: 'cs.CV', name: 'Computer Vision', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.CL', label: 'cs.CL', name: 'Computation & Language', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.RO', label: 'cs.RO', name: 'Robotics', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.NE', label: 'cs.NE', name: 'Neural & Evolutionary Computing', group: 'AI & ML', provider: 'arxiv' },
  { id: 'cs.IR', label: 'cs.IR', name: 'Information Retrieval', group: 'AI & ML', provider: 'arxiv' },
  { id: 'stat.ML', label: 'stat.ML', name: 'Statistics — Machine Learning', group: 'AI & ML', provider: 'arxiv' },

  // Physics
  { id: 'quant-ph', label: 'quant-ph', name: 'Quantum Physics', group: 'Physics', provider: 'arxiv' },
  { id: 'cond-mat.mes-hall', label: 'cond-mat', name: 'Condensed Matter', group: 'Physics', provider: 'arxiv' },
  { id: 'hep-th', label: 'hep-th', name: 'High Energy Theory', group: 'Physics', provider: 'arxiv' },
  { id: 'astro-ph.GA', label: 'astro-ph', name: 'Astrophysics', group: 'Physics', provider: 'arxiv' },
  { id: 'physics.optics', label: 'optics', name: 'Optics', group: 'Physics', provider: 'arxiv' },

  // Biology
  { id: 'q-bio.NC', label: 'q-bio.NC', name: 'Neurons & Cognition', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.GN', label: 'q-bio.GN', name: 'Genomics', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.BM', label: 'q-bio.BM', name: 'Biomolecules', group: 'Biology', provider: 'arxiv' },
  { id: 'q-bio.QM', label: 'q-bio.QM', name: 'Quantitative Methods', group: 'Biology', provider: 'arxiv' },

  // Medical (PubMed) — added in Task 4; kept here as the final registry
  // shape so this file only needs one edit across the whole plan.
  { id: 'med.ONC', label: 'Oncology', name: 'Oncology', group: 'Medical', provider: 'pubmed', query: 'cancer[Majr] OR neoplasms[Majr]' },
  { id: 'med.CARD', label: 'Cardiology', name: 'Cardiology', group: 'Medical', provider: 'pubmed', query: 'cardiovascular diseases[Majr]' },
  { id: 'med.NEURO', label: 'Neurology', name: 'Neurology', group: 'Medical', provider: 'pubmed', query: 'nervous system diseases[Majr]' },
  { id: 'med.ID', label: 'Infectious Disease', name: 'Infectious Disease', group: 'Medical', provider: 'pubmed', query: 'communicable diseases[Majr]' },
  { id: 'med.IMMUNO', label: 'Immunology', name: 'Immunology', group: 'Medical', provider: 'pubmed', query: 'immune system diseases[Majr]' },

  // Math
  { id: 'math.ST', label: 'math.ST', name: 'Statistics Theory', group: 'Math', provider: 'arxiv' },
  { id: 'math.OC', label: 'math.OC', name: 'Optimization & Control', group: 'Math', provider: 'arxiv' },
  { id: 'math.CO', label: 'math.CO', name: 'Combinatorics', group: 'Math', provider: 'arxiv' },
  { id: 'math.PR', label: 'math.PR', name: 'Probability', group: 'Math', provider: 'arxiv' },

  // Finance
  { id: 'q-fin.TR', label: 'q-fin.TR', name: 'Trading & Microstructure', group: 'Finance', provider: 'arxiv' },
  { id: 'q-fin.PM', label: 'q-fin.PM', name: 'Portfolio Management', group: 'Finance', provider: 'arxiv' },
  { id: 'q-fin.RM', label: 'q-fin.RM', name: 'Risk Management', group: 'Finance', provider: 'arxiv' },
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
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name]));
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
