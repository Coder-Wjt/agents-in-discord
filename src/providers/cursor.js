import { getProviderCapabilities, getProviderDisplayName } from '../provider-metadata.js';

export function createCursorProviderAdapter({
  buildArgs = () => [],
  parseEvent = () => {},
} = {}) {
  return {
    id: 'cursor',
    displayName: getProviderDisplayName('cursor'),
    capabilities: getProviderCapabilities('cursor'),
    runtime: {
      buildArgs,
      parseEvent,
    },
  };
}
