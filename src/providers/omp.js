import { createPiFamilyProviderAdapter } from './pi-family.js';

export function createOmpProviderAdapter(options = {}) {
  return createPiFamilyProviderAdapter('omp', options);
}
