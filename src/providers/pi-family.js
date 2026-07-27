import { getProviderCapabilities, getProviderDisplayName } from '../provider-metadata.js';

export function createPiFamilyProviderAdapter(id, {
  buildArgs = () => [],
  parseEvent = () => {},
} = {}) {
  return {
    id,
    displayName: getProviderDisplayName(id),
    capabilities: getProviderCapabilities(id),
    runtime: {
      buildArgs,
      parseEvent,
    },
  };
}
