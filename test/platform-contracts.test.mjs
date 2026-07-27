import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCORD_PLATFORM_CAPABILITIES,
  LARK_PLATFORM_CAPABILITIES,
  assertPlatformAdapter,
  createPlatformCapabilities,
} from '../src/platforms/index.js';

function createMessageDelivery() {
  return {
    reply() {},
    send() {},
    edit() {},
    startTyping() {},
    splitText() {},
    formatUserMention() {},
    setMessageStatus() {},
  };
}

function createNotificationDelivery() {
  return {
    sendNotification() {},
  };
}

function createEventNormalizer() {
  return {
    normalizeMessage() {},
    normalizeInteraction() {},
  };
}

function createCommandViewRenderer() {
  return {
    renderActionRows() {},
    renderMessage() {},
    renderModal() {},
  };
}

function createCommandRegistryRenderer() {
  return {
    renderCommands() {},
    formatCommandName: (name) => name,
    normalizeCommandName: (name) => name,
    formatCommandReference: (name) => `/${name}`,
  };
}

function createInteractionResponse() {
  return {
    respond() {},
    update() {},
    showModal() {},
    defer() {},
  };
}

function createConversationSpawn() {
  return {
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
  };
}

function createConversationPresentation() {
  return {
    getTerm: () => 'conversation',
  };
}

function createConversationSecurity() {
  return {
    resolve: () => ({
      conversationId: null,
      parentConversationId: null,
      tenantId: null,
      available: false,
      isDirect: false,
      visibility: 'unknown',
      reason: 'conversation unavailable',
    }),
  };
}

function createTextPresentation() {
  return {
    sanitizeDisplayText: (value) => String(value || ''),
  };
}

test('createPlatformCapabilities supplies boolean defaults and freezes the result', () => {
  const capabilities = createPlatformCapabilities({ attachments: true });

  assert.equal(capabilities.attachments, true);
  assert.equal(capabilities.threads, false);
  assert.equal(Object.isFrozen(capabilities), true);
});

test('Discord declares the currently supported interaction capabilities', () => {
  assert.deepEqual(DISCORD_PLATFORM_CAPABILITIES, {
    threads: true,
    slashCommands: true,
    buttons: true,
    selectMenus: true,
    modals: true,
    messageEdits: true,
    reactions: true,
    attachments: true,
  });
});

test('Lark declares reply-chain threads, native card controls, forms, message edits, reactions, and attachments', () => {
  assert.equal(LARK_PLATFORM_CAPABILITIES.threads, true);
  assert.deepEqual(LARK_PLATFORM_CAPABILITIES, {
    threads: true,
    slashCommands: true,
    buttons: true,
    selectMenus: true,
    modals: true,
    messageEdits: true,
    reactions: true,
    attachments: true,
  });
});

test('assertPlatformAdapter accepts a complete adapter', () => {
  const adapter = {
    id: 'example',
    capabilities: createPlatformCapabilities(),
    commandRegistryRenderer: createCommandRegistryRenderer(),
    commandViewRenderer: createCommandViewRenderer(),
    interactionResponse: createInteractionResponse(),
    eventNormalizer: createEventNormalizer(),
    messageDelivery: createMessageDelivery(),
    notificationDelivery: createNotificationDelivery(),
    conversationSpawn: createConversationSpawn(),
    conversationPresentation: createConversationPresentation(),
    conversationSecurity: createConversationSecurity(),
    textPresentation: createTextPresentation(),
    accessPolicy: {},
    entryHandlers: {},
    lifecycle: {},
  };

  assert.equal(assertPlatformAdapter(adapter), adapter);
});

test('assertPlatformAdapter rejects incomplete adapters', () => {
  assert.throws(
    () => assertPlatformAdapter({
      id: 'example',
      capabilities: createPlatformCapabilities(),
      commandRegistryRenderer: createCommandRegistryRenderer(),
      commandViewRenderer: createCommandViewRenderer(),
      interactionResponse: createInteractionResponse(),
      eventNormalizer: createEventNormalizer(),
      messageDelivery: createMessageDelivery(),
      notificationDelivery: createNotificationDelivery(),
      conversationSpawn: createConversationSpawn(),
      conversationPresentation: createConversationPresentation(),
      conversationSecurity: createConversationSecurity(),
      textPresentation: createTextPresentation(),
      accessPolicy: {},
      entryHandlers: {},
    }),
    /must provide lifecycle/,
  );
  assert.throws(
    () => createPlatformCapabilities({ buttons: 'yes' }),
    /must be a boolean/,
  );
  assert.throws(
    () => assertPlatformAdapter({
      id: 'example',
      capabilities: createPlatformCapabilities(),
      commandRegistryRenderer: createCommandRegistryRenderer(),
      commandViewRenderer: createCommandViewRenderer(),
      interactionResponse: createInteractionResponse(),
      eventNormalizer: createEventNormalizer(),
      messageDelivery: createMessageDelivery(),
      conversationSpawn: createConversationSpawn(),
      conversationPresentation: createConversationPresentation(),
      conversationSecurity: createConversationSecurity(),
      textPresentation: createTextPresentation(),
      accessPolicy: {},
      entryHandlers: {},
      lifecycle: {},
    }),
    /must provide notificationDelivery/,
  );
  assert.throws(
    () => assertPlatformAdapter({
      id: 'example',
      capabilities: createPlatformCapabilities(),
      commandRegistryRenderer: createCommandRegistryRenderer(),
      commandViewRenderer: createCommandViewRenderer(),
      interactionResponse: createInteractionResponse(),
      eventNormalizer: createEventNormalizer(),
      messageDelivery: {},
      notificationDelivery: createNotificationDelivery(),
      conversationSpawn: createConversationSpawn(),
      conversationPresentation: createConversationPresentation(),
      conversationSecurity: createConversationSecurity(),
      textPresentation: createTextPresentation(),
      accessPolicy: {},
      entryHandlers: {},
      lifecycle: {},
    }),
    /must provide reply\(\)/,
  );
  assert.throws(
    () => assertPlatformAdapter({
      id: 'example',
      capabilities: createPlatformCapabilities(),
      commandRegistryRenderer: createCommandRegistryRenderer(),
      commandViewRenderer: createCommandViewRenderer(),
      interactionResponse: createInteractionResponse(),
      eventNormalizer: {},
      messageDelivery: createMessageDelivery(),
      notificationDelivery: createNotificationDelivery(),
      conversationSpawn: createConversationSpawn(),
      conversationPresentation: createConversationPresentation(),
      conversationSecurity: createConversationSecurity(),
      textPresentation: createTextPresentation(),
      accessPolicy: {},
      entryHandlers: {},
      lifecycle: {},
    }),
    /must provide normalizeMessage\(\)/,
  );
  assert.throws(
    () => assertPlatformAdapter({
      id: 'example',
      capabilities: createPlatformCapabilities(),
      commandRegistryRenderer: createCommandRegistryRenderer(),
      commandViewRenderer: {},
      interactionResponse: createInteractionResponse(),
      eventNormalizer: createEventNormalizer(),
      messageDelivery: createMessageDelivery(),
      notificationDelivery: createNotificationDelivery(),
      conversationSpawn: createConversationSpawn(),
      conversationPresentation: createConversationPresentation(),
      conversationSecurity: createConversationSecurity(),
      textPresentation: createTextPresentation(),
      accessPolicy: {},
      entryHandlers: {},
      lifecycle: {},
    }),
    /must provide renderActionRows\(\)/,
  );
  assert.throws(
    () => assertPlatformAdapter({
      id: 'example',
      capabilities: createPlatformCapabilities(),
      commandRegistryRenderer: {},
      commandViewRenderer: createCommandViewRenderer(),
      interactionResponse: createInteractionResponse(),
      eventNormalizer: createEventNormalizer(),
      messageDelivery: createMessageDelivery(),
      notificationDelivery: createNotificationDelivery(),
      conversationSpawn: createConversationSpawn(),
      conversationPresentation: createConversationPresentation(),
      conversationSecurity: createConversationSecurity(),
      textPresentation: createTextPresentation(),
      accessPolicy: {},
      entryHandlers: {},
      lifecycle: {},
    }),
    /must provide renderCommands\(\)/,
  );
  assert.throws(
    () => assertPlatformAdapter({
      id: 'example',
      capabilities: createPlatformCapabilities(),
      commandRegistryRenderer: createCommandRegistryRenderer(),
      commandViewRenderer: createCommandViewRenderer(),
      interactionResponse: createInteractionResponse(),
      eventNormalizer: createEventNormalizer(),
      messageDelivery: createMessageDelivery(),
      notificationDelivery: createNotificationDelivery(),
      conversationSpawn: createConversationSpawn(),
      conversationPresentation: {},
      conversationSecurity: createConversationSecurity(),
      textPresentation: createTextPresentation(),
      accessPolicy: {},
      entryHandlers: {},
      lifecycle: {},
    }),
    /must provide getTerm\(\)/,
  );
});
