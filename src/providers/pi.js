import { createPiFamilyProviderAdapter } from './pi-family.js';

export function createPiProviderAdapter(options = {}) {
  return createPiFamilyProviderAdapter('pi', options);
}
