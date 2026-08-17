import { getProviderCapabilities, getProviderDisplayName } from '../provider-metadata.js';

export function createGrokProviderAdapter({
  buildArgs = () => [],
  parseEvent = () => {},
} = {}) {
  return {
    id: 'grok',
    displayName: getProviderDisplayName('grok'),
    capabilities: getProviderCapabilities('grok'),
    runtime: {
      buildArgs,
      parseEvent,
    },
  };
}
