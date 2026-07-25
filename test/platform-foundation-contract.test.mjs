import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlatformCapabilities } from '../src/platforms/capabilities.js';
import { assertPlatformFoundation } from '../src/platforms/foundation.js';

function createFoundation(overrides = {}) {
  return {
    id: 'example',
    capabilities: createPlatformCapabilities(),
    commandRegistryRenderer: {
      renderCommands() {},
      formatCommandName: (name) => name,
      normalizeCommandName: (name) => name,
      formatCommandReference: (name) => `/${name}`,
    },
    commandViewRenderer: {
      renderActionRows() {},
      renderMessage() {},
      renderModal() {},
    },
    interactionResponse: {
      respond() {},
      update() {},
      showModal() {},
      defer() {},
    },
    messageDelivery: {
      reply() {},
      send() {},
      edit() {},
      startTyping() {},
      splitText() {},
      formatUserMention() {},
      setMessageStatus() {},
    },
    notificationDelivery: {
      sendNotification() {},
    },
    conversationSpawn: {
      canSpawn() {},
      spawn() {},
      rename() {},
      remove() {},
      archive() {},
      send() {},
      listRecentMessages() {},
      splitText() {},
      createPromptMessage() {},
      formatUserMention() {},
      formatConversationReference() {},
    },
    conversationPresentation: {
      getTerm: () => 'conversation',
    },
    conversationSecurity: {
      resolve: () => ({
        conversationId: null,
        parentConversationId: null,
        tenantId: null,
        available: false,
        isDirect: false,
        visibility: 'unknown',
        reason: 'conversation unavailable',
      }),
    },
    textPresentation: {
      sanitizeDisplayText: (value) => String(value || ''),
    },
    createAdapter: () => ({}),
    ...overrides,
  };
}

test('platform foundation contract accepts pre-core platform services', () => {
  const foundation = createFoundation();

  assert.equal(assertPlatformFoundation(foundation), foundation);
});

test('platform foundation contract rejects missing services and adapter factory', () => {
  assert.throws(
    () => assertPlatformFoundation(createFoundation({ messageDelivery: {} })),
    /must provide reply\(\)/,
  );
  assert.throws(
    () => assertPlatformFoundation(createFoundation({ createAdapter: null })),
    /must provide createAdapter\(\)/,
  );
});
