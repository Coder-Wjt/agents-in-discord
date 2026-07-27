import test from 'node:test';
import assert from 'node:assert/strict';

import { parseConversationKey } from '../src/platforms/conversation-key.js';
import { createLarkInboundEventNormalizer } from '../src/platforms/lark/inbound-event.js';

test('Lark inbound normalizer creates qualified chat and reply-chain keys', async () => {
  const downloads = [];
  const normalizer = createLarkInboundEventNormalizer({
    getChannel: () => ({
      async downloadResource(fileKey, type) {
        downloads.push({ fileKey, type });
        return Buffer.from('image');
      },
    }),
  });
  const event = normalizer.normalizeMessage({
    messageId: 'om_1',
    chatId: 'oc_1',
    chatType: 'group',
    senderId: 'ou_1',
    senderName: 'User One',
    content: 'inspect this',
    mentionedBot: true,
    rootId: 'om_root',
    resources: [{ type: 'image', fileKey: 'img_1', fileName: 'brief.png' }],
    raw: { sender: { tenant_key: 'tenant_1' } },
  });

  assert.equal(event.platformId, 'lark');
  assert.equal(event.conversation.isThread, true);
  assert.deepEqual(parseConversationKey(event.conversation.id), {
    platformId: 'lark',
    tenantId: 'tenant_1',
    conversationId: 'oc_1',
    threadId: 'om_root',
  });
  assert.deepEqual(parseConversationKey(event.conversation.parentId), {
    platformId: 'lark',
    tenantId: 'tenant_1',
    conversationId: 'oc_1',
    threadId: null,
  });
  assert.equal(event.targetsBot, true);
  assert.equal(event.attachments[0].url, 'lark-resource://image/img_1');
  assert.deepEqual(await event.attachments[0].download(), Buffer.from('image'));
  assert.deepEqual(downloads, [{ fileKey: 'img_1', type: 'image' }]);
});

test('Lark inbound normalizer keeps reply-chain keys stable on root_id when thread_id is also present', () => {
  const normalizer = createLarkInboundEventNormalizer();
  const event = normalizer.normalizeMessage({
    messageId: 'om_reply',
    chatId: 'oc_1',
    chatType: 'group',
    senderId: 'ou_1',
    content: 'continue',
    rootId: 'om_root',
    threadId: 'omt_platform_thread',
    raw: { sender: { tenant_key: 'tenant_1' } },
  });

  assert.equal(parseConversationKey(event.conversation.id).threadId, 'om_root');
  assert.equal(event.responseTarget.threadId, 'omt_platform_thread');
});

test('Lark inbound normalizer treats direct chats as targeting the bot', () => {
  const event = createLarkInboundEventNormalizer().normalizeMessage({
    messageId: 'om_dm',
    chatId: 'oc_dm',
    chatType: 'p2p',
    senderId: 'ou_dm',
    content: 'hello',
  });
  assert.equal(event.targetsBot, true);
  assert.equal(event.conversation.isThread, false);
});

test('Lark inbound normalizer identifies app senders and the connected bot identity', () => {
  const normalizer = createLarkInboundEventNormalizer({
    getChannel: () => ({ botIdentity: { openId: 'ou_bot' } }),
  });
  const appEvent = normalizer.normalizeMessage({
    messageId: 'om_app',
    chatId: 'oc_group',
    chatType: 'group',
    senderId: 'ou_app',
    content: 'app message',
    raw: { sender: { sender_type: 'app' } },
  });
  const botEvent = normalizer.normalizeMessage({
    messageId: 'om_bot',
    chatId: 'oc_group',
    chatType: 'group',
    senderId: 'ou_bot',
    content: 'bot message',
  });

  assert.equal(appEvent.actor.isBot, true);
  assert.equal(botEvent.actor.isBot, true);
});

test('Lark inbound normalizer maps card buttons and selects to component interactions', () => {
  const normalizer = createLarkInboundEventNormalizer();
  const button = normalizer.normalizeInteraction({
    id: 'evt_button',
    messageId: 'om_card',
    chatId: 'oc_group',
    actorId: 'ou_user',
    action: { tag: 'button', value: { id: 'settings:open' } },
  });
  const select = normalizer.normalizeInteraction({
    id: 'evt_select',
    messageId: 'om_card',
    chatId: 'oc_group',
    actorId: 'ou_user',
    action: { tag: 'select_static', value: { id: 'settings:model' }, option: 'gpt-5.6' },
  });

  assert.equal(button.kind, 'button');
  assert.equal(button.component.id, 'settings:open');
  assert.equal(button.responseTarget.isCard, true);
  assert.equal(select.kind, 'select');
  assert.deepEqual(select.component.values, ['gpt-5.6']);
});

test('Lark inbound normalizer restores reply-chain context for card actions', () => {
  const normalizer = createLarkInboundEventNormalizer({
    resolveMessageTarget: (messageId) => (messageId === 'om_card'
      ? {
        chatId: 'oc_1',
        tenantId: 'tenant_1',
        rootId: 'om_root',
        threadId: 'om_root',
      }
      : null),
  });
  const event = normalizer.normalizeInteraction({
    id: 'evt_button',
    messageId: 'om_card',
    chatId: 'oc_1',
    actorId: 'ou_user',
    action: { tag: 'button', value: { id: 'settings:open' } },
  });

  assert.deepEqual(parseConversationKey(event.conversation.id), {
    platformId: 'lark',
    tenantId: 'tenant_1',
    conversationId: 'oc_1',
    threadId: 'om_root',
  });
  assert.equal(event.conversation.isThread, true);
  assert.equal(event.responseTarget.rootId, 'om_root');
});

test('Lark inbound normalizer maps SDK card form submits to modal interactions', () => {
  const event = createLarkInboundEventNormalizer().normalizeInteraction({
    messageId: 'om_card',
    chatId: 'oc_group',
    operator: { openId: 'ou_user', name: 'User One' },
    action: {
      tag: 'button',
      name: 'aid_modal_submit:stgm:model:ou_user',
    },
    raw: {
      action: {
        tag: 'button',
        name: 'aid_modal_submit:stgm:model:ou_user',
        form_value: {
          model_name: 'gpt-5.6',
        },
      },
    },
  });

  assert.equal(event.kind, 'modal');
  assert.equal(event.modal.id, 'stgm:model:ou_user');
  assert.equal(event.modal.getField('model_name'), 'gpt-5.6');
  assert.equal(event.responseTarget.isCard, true);
});
