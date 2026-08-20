import { arxivProvider } from './arxiv';
import type { Provider } from './types';
import type { ProviderName } from '@/lib/categories';

// pubmedProvider is added in Task 3.
const PROVIDERS: Partial<Record<ProviderName, Provider>> = {
  arxiv: arxivProvider,
};

export function getProvider(name: ProviderName): Provider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`No provider registered for '${name}'`);
  return provider;
}
