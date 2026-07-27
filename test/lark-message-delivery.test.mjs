import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
  createCommandModalView,
  createCommandTextInput,
} from '../src/platforms/command-view.js';
import { buildConversationKey } from '../src/platforms/conversation-key.js';
import { createLarkInboundEventNormalizer } from '../src/platforms/lark/inbound-event.js';
import { createLarkMessageDelivery, splitForLark } from '../src/platforms/lark/message-delivery.js';
import { createLarkNotificationDelivery } from '../src/platforms/lark/notification-delivery.js';
import { LARK_PRIVATE_CONTEXT_KEY } from '../src/platforms/lark/private-context.js';

test('Lark message delivery replies, sends in threads, and edits progress messages', async () => {
  const calls = [];
  const channel = {
    async send(chatId, input, options) {
      calls.push({ kind: 'send', chatId, input, options });
      return { messageId: `om_${calls.length}` };
    },
    async editMessage(messageId, text) {
      calls.push({ kind: 'edit', messageId, text });
    },
  };
  const delivery = createLarkMessageDelivery({ getChannel: () => channel });
  const target = {
    responseTarget: {
      chatId: 'oc_1',
      messageId: 'om_source',
      rootId: 'om_root',
    },
  };
  const reply = await delivery.reply(target, { content: 'working' });
  await delivery.send(target.responseTarget, 'follow-up');
  await delivery.edit(reply, { content: 'done' });

  assert.deepEqual(calls[0], {
    kind: 'send',
    chatId: 'oc_1',
    input: { text: 'working' },
    options: { replyTo: 'om_source', replyInThread: true },
  });
  assert.deepEqual(calls[1], {
    kind: 'send',
    chatId: 'oc_1',
    input: { text: 'follow-up' },
    options: { replyTo: 'om_root', replyInThread: true },
  });
  assert.deepEqual(calls[2], { kind: 'edit', messageId: 'om_1', text: 'done' });
});

test('Lark notification delivery accepts qualified conversation keys', async () => {
  const calls = [];
  const notification = createLarkNotificationDelivery({
    getChannel: () => ({
      async send(chatId, input) {
        calls.push({ chatId, input });
      },
    }),
  });
  const key = buildConversationKey({
    platformId: 'lark',
    tenantId: 'tenant_1',
    conversationId: 'oc_1',
  });
  assert.equal(await notification.sendNotification(key, { content: 'upgrade ready' }), true);
  assert.deepEqual(calls, [{ chatId: 'oc_1', input: { text: 'upgrade ready' } }]);
});

test('Lark message delivery can open a direct chat by user open id', async () => {
  const calls = [];
  const delivery = createLarkMessageDelivery({
    getChannel: () => ({
      async send(receiveId, input, options) {
        calls.push({ receiveId, input, options });
        return { messageId: 'om_dm', chatId: 'oc_dm' };
      },
    }),
  });

  const sent = await delivery.send({ userId: 'ou_user', tenantId: 'tenant_1' }, 'hello');

  assert.deepEqual(calls, [{ receiveId: 'ou_user', input: { text: 'hello' }, options: {} }]);
  assert.equal(sent.chatId, 'oc_dm');
  assert.equal(sent.responseTarget.chatType, 'p2p');
});

test('Lark private interactive delivery embeds and restores the source conversation context', async () => {
  const calls = [];
  const delivery = createLarkMessageDelivery({
    getChannel: () => ({
      async send(receiveId, input, options) {
        calls.push({ receiveId, input, options });
        return { messageId: 'om_private', chatId: 'oc_dm' };
      },
      async updateCard(messageId, card) {
        calls.push({ messageId, card });
      },
    }),
  });
  const parentId = buildConversationKey({
    platformId: 'lark',
    tenantId: 'tenant_1',
    conversationId: 'oc_group',
  });
  const sourceId = buildConversationKey({
    platformId: 'lark',
    tenantId: 'tenant_1',
    conversationId: 'oc_group',
    threadId: 'om_root',
  });
  const sent = await delivery.send({
    platformId: 'lark',
    userId: 'ou_user',
    tenantId: 'tenant_1',
    contextConversation: {
      id: sourceId,
      parentId,
      tenantId: 'tenant_1',
      isThread: true,
      raw: {
        platformId: 'lark',
        chatId: 'oc_group',
        chatType: 'group',
        tenantId: 'tenant_1',
        rootId: 'om_root',
        threadId: 'omt_platform',
      },
    },
  }, createCommandMessageView({
    content: 'Private settings',
    visibility: 'ephemeral',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'settings:private', label: 'Continue' }),
    ])],
  }));

  const actionValue = calls[0].input.card.elements[1].actions[0].value;
  assert.equal(calls[0].receiveId, 'ou_user');
  assert.equal(typeof actionValue[LARK_PRIVATE_CONTEXT_KEY], 'string');
  assert.equal(sent.responseTarget.contextConversation.id, sourceId);

  const restored = createLarkInboundEventNormalizer().normalizeInteraction({
    id: 'evt_private',
    messageId: 'om_private',
    chatId: 'oc_dm',
    actorId: 'ou_user',
    action: { tag: 'button', value: actionValue },
  });
  assert.equal(restored.conversation.id, sourceId);
  assert.equal(restored.conversation.parentId, parentId);
  assert.equal(restored.conversation.isThread, true);
  assert.equal(restored.conversation.raw.chatId, 'oc_group');
  assert.equal(restored.responseTarget.chatId, 'oc_dm');
  assert.equal(restored.responseTarget.contextConversation.id, sourceId);
  assert.equal(restored.component.id, 'settings:private');

  await delivery.edit(sent, createCommandModalView({
    id: 'stgm:model:ou_user',
    title: 'Private model',
    rows: [createCommandActionRow([
      createCommandTextInput({ id: 'model_name', label: 'Model' }),
    ])],
  }));
  const submitButton = calls[1].card.body.elements[0].elements.at(-1);
  assert.equal(typeof submitButton.value[LARK_PRIVATE_CONTEXT_KEY], 'string');
  const restoredModal = createLarkInboundEventNormalizer().normalizeInteraction({
    id: 'evt_private_modal',
    messageId: 'om_private',
    chatId: 'oc_dm',
    operator: { openId: 'ou_user' },
    action: {
      tag: 'button',
      name: 'aid_modal_submit:stgm:model:ou_user',
      value: submitButton.value,
    },
    raw: {
      action: {
        tag: 'button',
        name: 'aid_modal_submit:stgm:model:ou_user',
        value: submitButton.value,
        form_value: { model_name: 'gpt-5.6' },
      },
    },
  });
  assert.equal(restoredModal.kind, 'modal');
  assert.equal(restoredModal.conversation.id, sourceId);
  assert.equal(restoredModal.modal.getField('model_name'), 'gpt-5.6');
});

test('Lark private interaction context ignores malformed and cross-platform values', () => {
  const normalizer = createLarkInboundEventNormalizer();
  const sourceId = buildConversationKey({
    platformId: 'lark',
    tenantId: 'tenant_1',
    conversationId: 'oc_group',
    threadId: 'om_root',
  });
  const invalidValues = [
    '{',
    JSON.stringify({
      conversationId: buildConversationKey({
        platformId: 'discord',
        tenantId: 'guild_1',
        conversationId: 'channel_1',
      }),
    }),
    JSON.stringify({
      conversationId: sourceId,
      tenantId: 'tenant_1',
      chatId: 'oc_other',
      rootId: 'om_root',
    }),
    JSON.stringify({
      conversationId: sourceId,
      tenantId: 'tenant_other',
      chatId: 'oc_group',
      rootId: 'om_root',
    }),
  ];

  for (const [index, embeddedContext] of invalidValues.entries()) {
    const interaction = normalizer.normalizeInteraction({
      id: `evt_invalid_private_${index}`,
      messageId: 'om_private',
      chatId: 'oc_dm',
      chatType: 'p2p',
      tenantId: 'tenant_1',
      actorId: 'ou_user',
      action: {
        tag: 'button',
        value: {
          id: 'settings:private',
          [LARK_PRIVATE_CONTEXT_KEY]: embeddedContext,
        },
      },
    });

    assert.equal(interaction.conversation.id, buildConversationKey({
      platformId: 'lark',
      tenantId: 'tenant_1',
      conversationId: 'oc_dm',
    }));
    assert.equal(interaction.conversation.raw.chatId, 'oc_dm');
    assert.equal(interaction.responseTarget.contextConversation, undefined);
  }
});

test('Lark message delivery sends and updates native interactive cards', async () => {
  const calls = [];
  const channel = {
    async send(chatId, input, options) {
      calls.push({ kind: 'send', chatId, input, options });
      return { messageId: 'om_card' };
    },
    async updateCard(messageId, card) {
      calls.push({ kind: 'updateCard', messageId, card });
    },
  };
  const delivery = createLarkMessageDelivery({ getChannel: () => channel });
  const view = createCommandMessageView({
    content: '**Settings**',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'settings:open', label: 'Open', style: 'primary' }),
    ])],
  });
  const sent = await delivery.send({ chatId: 'oc_1' }, view);
  await delivery.edit(sent, createCommandMessageView({ content: 'Closed', rows: [] }));

  assert.equal(calls[0].input.card.elements[0].tag, 'markdown');
  assert.equal(calls[0].input.card.elements[1].actions[0].value.id, 'settings:open');
  assert.equal(sent.responseTarget.isCard, true);
  assert.equal(calls[1].kind, 'updateCard');
  assert.equal(calls[1].card.elements[0].content, 'Closed');
  assert.equal(delivery.resolveMessageTarget('om_card').chatId, 'oc_1');
});

test('Lark message delivery completes Card 2.0 forms before sending a fresh settings card', async () => {
  const calls = [];
  const channel = {
    async send(chatId, input, options) {
      calls.push({ kind: 'send', chatId, input, options });
      return { messageId: 'om_latest', chatId };
    },
    async updateCard(messageId, card) {
      calls.push({ kind: 'updateCard', messageId, card });
    },
  };
  const delivery = createLarkMessageDelivery({ getChannel: () => channel });
  const target = {
    chatId: 'oc_1',
    messageId: 'om_form',
    isCard: true,
  };

  const result = await delivery.completeModal(target, createCommandMessageView({
    content: '✅ compact 阈值已更新。这是最新的设置面板。',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'settings:default', label: '跟随默认阈值' }),
    ])],
  }));

  assert.equal(calls[0].kind, 'updateCard');
  assert.equal(calls[0].messageId, 'om_form');
  assert.equal(calls[0].card.schema, '2.0');
  assert.equal(calls[1].kind, 'send');
  assert.equal(calls[1].input.card.schema, undefined);
  assert.equal(calls[1].input.card.elements[1].actions[0].value.id, 'settings:default');
  assert.equal(result.messageId, 'om_latest');
});

test('splitForLark keeps chunks within the configured size', () => {
  const chunks = splitForLark('a'.repeat(4500), 4000);
  assert.equal(chunks.length, 2);
  assert.equal(chunks.every((chunk) => chunk.length <= 4000), true);
});

test('Lark message delivery applies the configured default text chunk limit', () => {
  const delivery = createLarkMessageDelivery({ textChunkLimit: 1200 });
  const chunks = delivery.splitText('a'.repeat(2500));

  assert.equal(chunks.length, 3);
  assert.equal(chunks.every((chunk) => chunk.length <= 1200), true);
});

test('Lark message delivery maps semantic statuses to reactions', async () => {
  const calls = [];
  const delivery = createLarkMessageDelivery({
    getChannel: () => ({
      async addReaction(messageId, emojiType) {
        calls.push({ kind: 'add', messageId, emojiType });
      },
      async removeReactionByEmoji(messageId, emojiType) {
        calls.push({ kind: 'remove', messageId, emojiType });
        return true;
      },
    }),
  });
  const message = { responseTarget: { chatId: 'oc_1', messageId: 'om_source' } };

  await delivery.setMessageStatus(message, 'processing');
  await delivery.setMessageStatus(message, 'cancelled');

  assert.deepEqual(calls, [
    { kind: 'add', messageId: 'om_source', emojiType: 'THINKING' },
    { kind: 'remove', messageId: 'om_source', emojiType: 'THINKING' },
    { kind: 'add', messageId: 'om_source', emojiType: 'No' },
  ]);
  await assert.rejects(() => delivery.setMessageStatus(message, 'unknown'), /Unsupported message status/);
});

test('Lark message delivery exposes successful and failed delivery metrics', async () => {
  let timestamp = 1000;
  const delivery = createLarkMessageDelivery({
    now: () => timestamp,
    getChannel: () => ({
      async send(chatId) {
        if (chatId === 'oc_fail') throw new Error('send timeout');
        return { messageId: 'om_ok', chatId };
      },
    }),
  });

  await delivery.send({ chatId: 'oc_ok' }, 'ok');
  timestamp = 2500;
  await assert.rejects(() => delivery.reply({ chatId: 'oc_fail' }, 'fail'), /send timeout/);

  assert.deepEqual(delivery.getMetricsSnapshot(), {
    available: true,
    attempted: 2,
    succeeded: 1,
    failed: 1,
    inFlight: 0,
    byOperation: {
      send: { attempted: 1, succeeded: 1, failed: 0 },
      reply: { attempted: 1, succeeded: 0, failed: 1 },
    },
    lastSuccessAt: 1000,
    lastFailure: {
      operation: 'reply',
      at: 2500,
      error: 'send timeout',
    },
  });
});
