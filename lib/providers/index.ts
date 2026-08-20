import { arxivProvider } from './arxiv';
import { pubmedProvider } from './pubmed';
import type { Provider } from './types';
import type { ProviderName } from '@/lib/categories';

const PROVIDERS: Record<ProviderName, Provider> = {
  arxiv: arxivProvider,
  pubmed: pubmedProvider,
};

export function getProvider(name: ProviderName): Provider {
  return PROVIDERS[name];
}
