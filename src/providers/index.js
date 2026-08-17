import { normalizeProvider } from '../provider-metadata.js';

export function createProviderAdapterRegistry(adapters = []) {
  const byId = new Map();
  for (const adapter of adapters) {
    const id = normalizeProvider(adapter?.id || '');
    if (!id) continue;
    byId.set(id, adapter);
  }

  return {
    get(provider) {
      const normalized = normalizeProvider(provider);
      const adapter = byId.get(normalized);
      if (!adapter) throw new Error(`provider adapter not registered: ${normalized}`);
      return adapter;
    },
    list() {
      return [...byId.values()];
    },
  };
}
