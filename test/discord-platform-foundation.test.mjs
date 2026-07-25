import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlatformCapabilities } from '../src/platforms/capabilities.js';
import { createDiscordPlatformFoundation } from '../src/platforms/discord/foundation.js';

test('Discord platform foundation builds reusable pre-core services and adapter factory', () => {
  const calls = {};
  const capabilities = createPlatformCapabilities({
    threads: true,
    slashCommands: true,
    buttons: true,
    selectMenus: true,
    modals: true,
    messageEdits: true,
    reactions: true,
    attachments: true,
  });
  const commandRegistryRenderer = {
    renderCommands() {},
    formatCommandName: (name) => name,
    normalizeCommandName: (name) => name,
    formatCommandReference: (name) => `/${name}`,
  };
  const commandViewRenderer = {
    renderActionRows() {},
    renderMessage() {},
    renderModal() {},
  };
  const interactionResponse = {
    respond() {},
    update() {},
    showModal() {},
    defer() {},
  };
  const messageDelivery = {
    reply() {},
    send() {},
    edit() {},
    startTyping() {},
    splitText() {},
    formatUserMention() {},
    setMessageStatus() {},
  };
  const notificationDelivery = { sendNotification() {} };
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
  const conversationPresentation = { getTerm: () => 'Discord channel' };
  const conversationSecurity = { resolve: () => ({}) };
  const textPresentation = { sanitizeDisplayText: (value) => String(value || '') };

  const foundation = createDiscordPlatformFoundation({
    capabilities,
    commandRegistryRendererOptions: { registry: true },
    commandViewRendererOptions: { view: true },
    interactionResponseOptions: { response: true },
    messageDeliveryOptions: { delivery: true },
    notificationDeliveryOptions: { notification: true },
    conversationSpawnOptions: { spawn: true },
    conversationPresentationOptions: { presentation: true },
    conversationSecurityOptions: { security: true },
    textPresentationOptions: { text: true },
    factories: {
      createCommandRegistryRenderer(options) {
        calls.commandRegistryRenderer = options;
        return commandRegistryRenderer;
      },
      createCommandViewRenderer(options) {
        calls.commandViewRenderer = options;
        return commandViewRenderer;
      },
      createInteractionResponse(options) {
        calls.interactionResponse = options;
        return interactionResponse;
      },
      createMessageDelivery(options) {
        calls.messageDelivery = options;
        return messageDelivery;
      },
      createNotificationDelivery(options) {
        calls.notificationDelivery = options;
        return notificationDelivery;
      },
      createConversationSpawn(options) {
        calls.conversationSpawn = options;
        return conversationSpawn;
      },
      createConversationPresentation(options) {
        calls.conversationPresentation = options;
        return conversationPresentation;
      },
      createConversationSecurity(options) {
        calls.conversationSecurity = options;
        return conversationSecurity;
      },
      createTextPresentation(options) {
        calls.textPresentation = options;
        return textPresentation;
      },
      createCommandRegistryPolicy: ({ renderer }) => renderer,
      createCommandViewPolicy: ({ renderer }) => renderer,
      createInteractionResponsePolicy: ({ interactionResponse: response }) => response,
      createMessageDeliveryPolicy: ({ messageDelivery: delivery }) => delivery,
      createAdapter(options) {
        calls.adapter = options;
        return { id: 'discord' };
      },
    },
  });

  assert.equal(foundation.id, 'discord');
  assert.equal(foundation.capabilities, capabilities);
  assert.equal(foundation.commandRegistryRenderer, commandRegistryRenderer);
  assert.equal(foundation.commandViewRenderer, commandViewRenderer);
  assert.equal(foundation.messageDelivery, messageDelivery);
  assert.equal(foundation.conversationSecurity, conversationSecurity);
  assert.equal(foundation.textPresentation, textPresentation);
  assert.equal(calls.messageDelivery.commandViewRenderer, commandViewRenderer);
  assert.deepEqual(calls.conversationSecurity, { security: true });

  const adapter = foundation.createAdapter({ entryHandlerOptions: { core: true } });
  assert.deepEqual(adapter, { id: 'discord' });
  assert.equal(calls.adapter.capabilities, capabilities);
  assert.equal(calls.adapter.messageDelivery, messageDelivery);
  assert.equal(calls.adapter.textPresentation, textPresentation);
  assert.deepEqual(calls.adapter.entryHandlerOptions, { core: true });
});
