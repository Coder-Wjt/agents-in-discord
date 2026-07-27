import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
  createCommandModalView,
  createCommandTextInput,
} from '../src/platforms/command-view.js';
import { createLarkPlatformFoundation } from '../src/platforms/lark/foundation.js';

test('Lark foundation sends a native card and routes its action to an in-place update', async () => {
  const calls = [];
  const channel = {
    on() {},
    async send(chatId, input, options) {
      calls.push({ kind: 'send', chatId, input, options });
      return { messageId: 'om_card' };
    },
    async updateCard(messageId, card) {
      calls.push({ kind: 'updateCard', messageId, card });
    },
    async editMessage() {},
    async addReaction() {},
    async removeReactionByEmoji() { return true; },
  };
  const foundation = createLarkPlatformFoundation({
    eventNormalizerOptions: { getChannel: () => channel },
    messageDeliveryOptions: { getChannel: () => channel },
    notificationDeliveryOptions: { getChannel: () => channel },
  });
  let adapter;
  adapter = foundation.createAdapter({
    entryHandlerOptions: {
      logger: { log() {}, warn() {}, error() {} },
      getSession: () => ({}),
      resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
      handleCommand: async () => {},
      enqueuePrompt: async () => {},
      isSettingsPanelComponentId: (id) => id === 'settings:open',
      async handleSettingsPanelInteraction(interaction) {
        await adapter.interactionResponse.update(interaction, createCommandMessageView({
          content: '**Updated settings**',
          rows: [],
        }));
      },
    },
    factories: {
      createLifecycle: () => ({}),
    },
  });

  await adapter.messageDelivery.send({ chatId: 'oc_1' }, createCommandMessageView({
    content: '**Settings**',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'settings:open', label: 'Open', style: 'primary' }),
    ])],
  }));
  await adapter.entryHandlers.handleInteractionCreate({
    id: 'evt_1',
    messageId: 'om_card',
    chatId: 'oc_1',
    actorId: 'ou_user',
    action: { tag: 'button', value: { id: 'settings:open' } },
  });

  assert.equal(calls[0].kind, 'send');
  assert.equal(calls[0].input.card.elements[1].actions[0].value.id, 'settings:open');
  assert.equal(calls[1].kind, 'updateCard');
  assert.equal(calls[1].messageId, 'om_card');
  assert.equal(calls[1].card.elements[0].content, '**Updated settings**');
});

test('Lark ephemeral component responses move to a private card without changing source session context', async () => {
  const calls = [];
  const observedConversations = [];
  const channel = {
    on() {},
    async send(receiveId, input, options) {
      calls.push({ kind: 'send', receiveId, input, options });
      return receiveId === 'ou_user'
        ? { messageId: 'om_private', chatId: 'oc_dm' }
        : { messageId: 'om_source', chatId: 'oc_group' };
    },
    async updateCard(messageId, card) {
      calls.push({ kind: 'updateCard', messageId, card });
    },
    async editMessage() {},
    async addReaction() {},
    async removeReactionByEmoji() { return true; },
  };
  const foundation = createLarkPlatformFoundation({
    eventNormalizerOptions: { getChannel: () => channel },
    messageDeliveryOptions: { getChannel: () => channel },
    notificationDeliveryOptions: { getChannel: () => channel },
  });
  let adapter;
  adapter = foundation.createAdapter({
    entryHandlerOptions: {
      logger: { log() {}, warn() {}, error() {} },
      getSession: () => ({}),
      resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
      handleCommand: async () => {},
      enqueuePrompt: async () => {},
      isSettingsPanelComponentId: (id) => id.startsWith('settings:'),
      async handleSettingsPanelInteraction(interaction) {
        observedConversations.push(interaction.conversation.id);
        if (interaction.component.id === 'settings:private') {
          await adapter.interactionResponse.respond(interaction, createCommandMessageView({
            content: 'Private settings',
            visibility: 'ephemeral',
            rows: [createCommandActionRow([
              createCommandButton({ id: 'settings:next', label: 'Next' }),
            ])],
          }));
          return;
        }
        await adapter.interactionResponse.update(interaction, createCommandMessageView({
          content: 'Private settings updated',
        }));
      },
    },
    factories: {
      createLifecycle: () => ({}),
    },
  });

  const sourceId = 'platform:v1:lark:tenant_1:oc_group:om_root';
  const parentId = 'platform:v1:lark:tenant_1:oc_group:';
  await adapter.messageDelivery.send({
    chatId: 'oc_group',
    chatType: 'group',
    tenantId: 'tenant_1',
    rootId: 'om_root',
  }, createCommandMessageView({
    content: 'Shared settings',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'settings:private', label: 'Open private' }),
    ])],
  }));
  await adapter.entryHandlers.handleInteractionCreate({
    id: 'evt_private_open',
    messageId: 'om_source',
    chatId: 'oc_group',
    actorId: 'ou_user',
    tenantId: 'tenant_1',
    rootId: 'om_root',
    action: { tag: 'button', value: { id: 'settings:private' } },
  });

  assert.equal(observedConversations[0], sourceId);
  assert.equal(calls[1].kind, 'send');
  assert.equal(calls[1].receiveId, 'ou_user');
  const privateAction = calls[1].input.card.elements[1].actions[0].value;

  await adapter.entryHandlers.handleInteractionCreate({
    id: 'evt_private_next',
    messageId: 'om_private',
    chatId: 'oc_dm',
    actorId: 'ou_user',
    action: { tag: 'button', value: privateAction },
  });

  assert.equal(observedConversations[1], sourceId);
  assert.equal(calls[2].kind, 'updateCard');
  assert.equal(calls[2].messageId, 'om_private');
  assert.equal(calls[2].card.elements[0].content, 'Private settings updated');
  assert.equal(adapter.messageDelivery.resolveMessageTarget('om_private').contextConversation.parentId, parentId);
});

test('Lark permission denials are delivered privately without replacing the shared card', async () => {
  const calls = [];
  let settingsCalls = 0;
  const channel = {
    on() {},
    async send(receiveId, input, options) {
      calls.push({ kind: 'send', receiveId, input, options });
      return receiveId === 'ou_intruder'
        ? { messageId: 'om_denied', chatId: 'oc_intruder_dm' }
        : { messageId: 'om_shared', chatId: 'oc_group' };
    },
    async updateCard(messageId, card) {
      calls.push({ kind: 'updateCard', messageId, card });
    },
    async editMessage() {},
    async addReaction() {},
    async removeReactionByEmoji() { return true; },
  };
  const foundation = createLarkPlatformFoundation({
    eventNormalizerOptions: { getChannel: () => channel },
    messageDeliveryOptions: { getChannel: () => channel },
    notificationDeliveryOptions: { getChannel: () => channel },
  });
  const adapter = foundation.createAdapter({
    accessPolicyOptions: {
      allowedUserIds: new Set(['ou_owner']),
    },
    entryHandlerOptions: {
      logger: { log() {}, warn() {}, error() {} },
      getSession: () => ({}),
      resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
      handleCommand: async () => {},
      enqueuePrompt: async () => {},
      isSettingsPanelComponentId: (id) => id === 'settings:open',
      async handleSettingsPanelInteraction() { settingsCalls += 1; },
    },
    factories: {
      createLifecycle: () => ({}),
    },
  });

  await adapter.messageDelivery.send({
    chatId: 'oc_group',
    chatType: 'group',
    tenantId: 'tenant_1',
  }, createCommandMessageView({
    content: 'Shared settings',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'settings:open', label: 'Open' }),
    ])],
  }));
  await adapter.entryHandlers.handleInteractionCreate({
    id: 'evt_denied',
    messageId: 'om_shared',
    chatId: 'oc_group',
    actorId: 'ou_intruder',
    tenantId: 'tenant_1',
    action: { tag: 'button', value: { id: 'settings:open' } },
  });

  assert.equal(settingsCalls, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].kind, 'send');
  assert.equal(calls[1].receiveId, 'ou_intruder');
  assert.deepEqual(calls[1].input, { text: '⛔ 没有权限。' });
});

test('Lark foundation opens and submits a shared modal through an in-place Card 2.0 form', async () => {
  const calls = [];
  const submissions = [];
  const channel = {
    on() {},
    async send(chatId, input, options) {
      calls.push({ kind: 'send', chatId, input, options });
      return { messageId: 'om_modal' };
    },
    async updateCard(messageId, card) {
      calls.push({ kind: 'updateCard', messageId, card });
    },
    async editMessage() {},
    async addReaction() {},
    async removeReactionByEmoji() { return true; },
  };
  const foundation = createLarkPlatformFoundation({
    eventNormalizerOptions: { getChannel: () => channel },
    messageDeliveryOptions: { getChannel: () => channel },
    notificationDeliveryOptions: { getChannel: () => channel },
  });
  let adapter;
  adapter = foundation.createAdapter({
    entryHandlerOptions: {
      logger: { log() {}, warn() {}, error() {} },
      getSession: () => ({}),
      resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
      handleCommand: async () => {},
      enqueuePrompt: async () => {},
      isSettingsPanelComponentId: (id) => id === 'settings:edit-model',
      isSettingsPanelModalId: (id) => id === 'stgm:model:ou_user',
      async handleSettingsPanelInteraction(interaction) {
        await adapter.interactionResponse.showModal(interaction, createCommandModalView({
          id: 'stgm:model:ou_user',
          title: 'Set model',
          rows: [createCommandActionRow([
            createCommandTextInput({
              id: 'model_name',
              label: 'Model',
              value: 'gpt-5.4',
              required: true,
              maxLength: 120,
            }),
          ])],
        }));
      },
      async handleSettingsPanelModalSubmit(interaction) {
        submissions.push(interaction.modal.getField('model_name'));
        await adapter.interactionResponse.respond(interaction, {
          content: `Saved ${interaction.modal.getField('model_name')}`,
          visibility: 'ephemeral',
        });
      },
    },
    factories: {
      createLifecycle: () => ({}),
    },
  });

  await adapter.messageDelivery.send({ chatId: 'oc_1' }, createCommandMessageView({
    content: '**Settings**',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'settings:edit-model', label: 'Edit model', style: 'primary' }),
    ])],
  }));
  await adapter.entryHandlers.handleInteractionCreate({
    id: 'evt_open',
    messageId: 'om_modal',
    chatId: 'oc_1',
    actorId: 'ou_user',
    action: { tag: 'button', value: { id: 'settings:edit-model' } },
  });
  await adapter.entryHandlers.handleInteractionCreate({
    id: 'evt_submit',
    messageId: 'om_modal',
    chatId: 'oc_1',
    operator: { openId: 'ou_user' },
    action: {
      tag: 'button',
      name: 'aid_modal_submit:stgm:model:ou_user',
    },
    raw: {
      action: {
        tag: 'button',
        name: 'aid_modal_submit:stgm:model:ou_user',
        form_value: { model_name: 'gpt-5.6' },
      },
    },
  });

  assert.equal(calls[1].kind, 'updateCard');
  assert.equal(calls[1].messageId, 'om_modal');
  assert.equal(calls[1].card.schema, '2.0');
  assert.equal(calls[1].card.body.elements[0].elements[0].default_value, 'gpt-5.4');
  assert.deepEqual(submissions, ['gpt-5.6']);
  assert.equal(calls[2].kind, 'updateCard');
  assert.equal(calls[2].card.elements[0].content, 'Saved gpt-5.6');
});

test('Lark foundation routes a native bot menu event through the shared command router', async () => {
  const calls = [];
  const routed = [];
  const channel = {
    on() {},
    async send(receiveId, input, options) {
      calls.push({ kind: 'send', receiveId, input, options });
      return { messageId: 'om_menu', chatId: 'oc_dm' };
    },
    async updateCard(messageId, card) {
      calls.push({ kind: 'updateCard', messageId, card });
    },
    async editMessage() {},
    async addReaction() {},
    async removeReactionByEmoji() { return true; },
  };
  const foundation = createLarkPlatformFoundation({
    eventNormalizerOptions: { getChannel: () => channel },
    messageDeliveryOptions: { getChannel: () => channel },
    notificationDeliveryOptions: { getChannel: () => channel },
  });
  const adapter = foundation.createAdapter({
    entryHandlerOptions: {
      logger: { log() {}, warn() {}, error() {} },
      getSession: () => ({}),
      resolveSecurityContext: () => ({ profile: 'team', mentionOnly: false }),
      handleCommand: async () => {},
      enqueuePrompt: async () => {},
      normalizeSlashCommandName: (name) => String(name || '').toLowerCase(),
      async routeSlashCommand({ interaction, commandName, respond }) {
        routed.push({
          commandName,
          actorId: interaction.actor.id,
          conversationId: interaction.conversation.id,
        });
        await respond({ content: '**Status ready**', visibility: 'ephemeral' });
        return true;
      },
    },
    factories: {
      createLifecycle: () => ({}),
    },
  });

  await adapter.entryHandlers.handleBotMenu({
    id: 'evt_menu',
    eventKey: 'status',
    actorId: 'ou_user',
    actorName: 'User One',
    tenantId: 'tenant_1',
    raw: {},
  });

  assert.equal(calls[0].kind, 'send');
  assert.equal(calls[0].receiveId, 'ou_user');
  assert.equal(calls[0].input.card.elements[0].content, '⏳ 正在处理菜单命令…');
  assert.equal(routed.length, 1);
  assert.equal(routed[0].commandName, 'status');
  assert.equal(routed[0].actorId, 'ou_user');
  assert.match(routed[0].conversationId, /^platform:v1:lark:/);
  assert.equal(calls[1].kind, 'updateCard');
  assert.equal(calls[1].messageId, 'om_menu');
  assert.equal(calls[1].card.elements[0].content, '**Status ready**');
});
