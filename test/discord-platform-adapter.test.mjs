import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordPlatformAdapter } from '../src/platforms/discord/adapter.js';

test('Discord platform adapter composes existing factories in dependency order', () => {
  const calls = [];
  const accessPolicy = { allowed: true };
  const entryHandlers = { bindClientHandlers: () => 'bound' };
  const lifecycle = { bootClient: async () => 'client' };
  const messageDelivery = {
    reply() {},
    send() {},
    edit() {},
    startTyping() {},
    splitText() {},
    formatUserMention() {},
    setMessageStatus() {},
  };
  const notificationDelivery = {
    sendNotification() {},
  };
  const eventNormalizer = {
    normalizeMessage(message) {
      return { raw: message };
    },
    normalizeInteraction(interaction) {
      return { raw: interaction };
    },
  };
  const commandViewRenderer = {
    renderActionRows() {},
    renderMessage() {},
    renderModal() {},
  };
  const commandRegistryRenderer = {
    renderCommands() {},
    formatCommandName: (name) => name,
    normalizeCommandName: (name) => name,
    formatCommandReference: (name) => `/${name}`,
  };
  const interactionResponse = {
    respond() {},
    update() {},
    showModal() {},
    defer() {},
  };
  const conversationSpawn = {
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
  const conversationSecurity = {
    resolve() {
      return {
        conversationId: null,
        parentConversationId: null,
        tenantId: null,
        available: false,
        isDirect: false,
        visibility: 'unknown',
        reason: 'conversation unavailable',
      };
    },
  };
  const textPresentation = {
    sanitizeDisplayText: (value) => String(value || ''),
  };
  const suppliedAccessPolicy = { ignored: true };
  const suppliedBindClientHandlers = () => 'ignored';

  const adapter = createDiscordPlatformAdapter({
    commandRegistryRenderer,
    commandViewRenderer,
    interactionResponse,
    eventNormalizer,
    messageDelivery,
    notificationDelivery,
    conversationSpawn,
    conversationSecurity,
    textPresentation,
    accessPolicyOptions: { allowedChannelIds: new Set(['channel-1']) },
    entryHandlerOptions: {
      logger: console,
      accessPolicy: suppliedAccessPolicy,
    },
    lifecycleOptions: {
      selfHealEnabled: true,
      bindClientHandlers: suppliedBindClientHandlers,
    },
    factories: {
      createAccessPolicy: (options) => {
        calls.push(['accessPolicy', options]);
        return accessPolicy;
      },
      createEntryHandlers: (options) => {
        calls.push(['entryHandlers', options]);
        return entryHandlers;
      },
      createLifecycle: (options) => {
        calls.push(['lifecycle', options]);
        return lifecycle;
      },
    },
  });

  assert.deepEqual(calls.map(([name]) => name), [
    'accessPolicy',
    'entryHandlers',
    'lifecycle',
  ]);
  assert.deepEqual(calls[0][1].allowedChannelIds, new Set(['channel-1']));
  assert.equal(calls[1][1].accessPolicy, accessPolicy);
  assert.equal(calls[1][1].commandRegistryRenderer, adapter.commandRegistryRenderer);
  assert.equal(calls[1][1].interactionResponse, adapter.interactionResponse);
  assert.equal(calls[1][1].normalizeInteractionEvent, adapter.eventNormalizer.normalizeInteraction);
  assert.equal(calls[1][1].normalizeMessageEvent, adapter.eventNormalizer.normalizeMessage);
  assert.equal(calls[1][1].messageDelivery, adapter.messageDelivery);
  assert.equal(calls[2][1].bindClientHandlers, entryHandlers.bindClientHandlers);
  assert.equal(adapter.id, 'discord');
  assert.notEqual(adapter.commandRegistryRenderer, commandRegistryRenderer);
  assert.notEqual(adapter.commandViewRenderer, commandViewRenderer);
  assert.notEqual(adapter.interactionResponse, interactionResponse);
  assert.equal(adapter.commandRegistryRenderer.formatCommandReference('status'), '/status');
  assert.notEqual(adapter.eventNormalizer, eventNormalizer);
  assert.notEqual(adapter.messageDelivery, messageDelivery);
  assert.equal(adapter.notificationDelivery, notificationDelivery);
  assert.equal(adapter.conversationSpawn, conversationSpawn);
  assert.equal(adapter.conversationSecurity, conversationSecurity);
  assert.equal(adapter.textPresentation, textPresentation);
  assert.equal(adapter.conversationPresentation.getTerm('sourceConversation', 'en'), 'Discord channel');
  assert.equal(adapter.conversationPresentation.getTerm('childConversation', 'zh'), 'Discord thread');
  assert.equal(adapter.accessPolicy, accessPolicy);
  assert.equal(adapter.entryHandlers, entryHandlers);
  assert.equal(adapter.lifecycle, lifecycle);
  assert.equal(adapter.capabilities.slashCommands, true);
  assert.equal(adapter.capabilities.selectMenus, true);
});
