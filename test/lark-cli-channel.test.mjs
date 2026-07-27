import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  createLarkCliChannel,
  extractLarkCliResources,
  normalizeLarkCliCardActionEvent,
  normalizeLarkCliMessageEvent,
  stripLarkCliBotMentions,
} from '../src/lark-cli-channel.js';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killSignals = [];
  }

  kill(signal) {
    this.killSignals.push(signal);
    queueMicrotask(() => this.emit('close', 0, signal));
    return true;
  }
}

test('Lark CLI event normalization maps mentions, replies, and resources', () => {
  const event = normalizeLarkCliMessageEvent({
    type: 'im.message.receive_v1',
    message_id: 'om_1',
    chat_id: 'oc_1',
    chat_type: 'group',
    sender_id: 'ou_user',
    sender_type: 'user',
    root_id: 'om_root',
    thread_id: 'omt_1',
    reply_to: 'om_parent',
    content: 'look [Image: img_1] <file key="file_1" name="report.pdf"/>',
    mentions: [{ id: 'ou_bot', name: 'Bot' }],
  }, { botOpenId: 'ou_bot' });

  assert.equal(event.messageId, 'om_1');
  assert.equal(event.replyToMessageId, 'om_parent');
  assert.equal(event.mentionedBot, true);
  assert.equal(event.raw.senderType, 'user');
  assert.deepEqual(event.resources, [
    { fileKey: 'img_1', type: 'image', fileName: undefined },
    { fileKey: 'file_1', type: 'file', fileName: 'report.pdf' },
  ]);
});

test('Lark CLI normalization strips the connected bot mention like the SDK channel', () => {
  assert.equal(stripLarkCliBotMentions(
    '<at user_id="ou_bot">Test Bot</at> !status',
    [{ id: 'ou_bot', name: 'Test Bot' }],
    'ou_bot',
  ), '!status');
  assert.equal(stripLarkCliBotMentions(
    '@_user_1 !cancel @Other',
    [{ id: { open_id: 'ou_bot' }, key: '@_user_1', name: 'Test Bot' }],
    'ou_bot',
  ), '!cancel @Other');
  assert.equal(stripLarkCliBotMentions(
    '@Other hello',
    [{ id: 'ou_other', name: 'Other' }],
    'ou_bot',
  ), '@Other hello');

  const event = normalizeLarkCliMessageEvent({
    message_id: 'om_command',
    chat_id: 'oc_group',
    chat_type: 'group',
    sender_id: 'ou_user',
    content: '@Test Bot !status',
    mentions: [{ id: 'ou_bot', name: 'Test Bot' }],
  }, { botOpenId: 'ou_bot' });

  assert.equal(event.content, '!status');
  assert.equal(event.mentionedBot, true);
});

test('Lark CLI resource extraction deduplicates rendered media references', () => {
  assert.deepEqual(
    extractLarkCliResources('[Image: img_1] ![Image](img_1) [Media: file_2] <audio key="file_2"/>'),
    [
      { fileKey: 'img_1', type: 'image', fileName: undefined },
      { fileKey: 'file_2', type: 'file', fileName: undefined },
    ],
  );
});

test('Lark CLI card action normalization maps component ids and selected values', () => {
  const event = normalizeLarkCliCardActionEvent({
    event_id: 'evt_1',
    message_id: 'om_card',
    chat_id: 'oc_1',
    operator_id: 'ou_user',
    action_tag: 'select_static',
    action_value: JSON.stringify({ id: 'settings:model' }),
    option: 'gpt-5.6',
    token: 'token_1',
  });

  assert.equal(event.messageId, 'om_card');
  assert.equal(event.operator.openId, 'ou_user');
  assert.equal(event.action.value.id, 'settings:model');
  assert.equal(event.action.option, 'gpt-5.6');
});

test('Lark CLI card action normalization preserves form submissions', () => {
  const event = normalizeLarkCliCardActionEvent({
    event_id: 'evt_form',
    message_id: 'om_card',
    chat_id: 'oc_1',
    operator_id: 'ou_user',
    action_tag: 'button',
    action_name: 'aid_modal_submit:stgm:profile:ou_user',
    action_value: '',
    form_value: JSON.stringify({ codex_profile_name: 'review' }),
  });

  assert.equal(event.action.name, 'aid_modal_submit:stgm:profile:ou_user');
  assert.deepEqual(event.action.formValue, { codex_profile_name: 'review' });
});

test('Lark CLI channel connects, emits messages, and routes outbound operations', async () => {
  const calls = [];
  const execFileFn = async (_bin, args) => {
    calls.push(args);
    if (args.includes('status')) {
      return {
        stdout: JSON.stringify({
          identities: {
            bot: {
              status: 'ready',
              available: true,
              verified: true,
              openId: 'ou_bot',
              appName: 'Test Bot',
            },
          },
        }),
        stderr: '',
      };
    }
    if (args.includes('+messages-send')) {
      return { stdout: JSON.stringify({ ok: true, data: { message_id: 'om_sent', chat_id: 'oc_1' } }), stderr: '' };
    }
    if (args.includes('+messages-reply')) {
      return { stdout: JSON.stringify({ ok: true, data: { message_id: 'om_reply', chat_id: 'oc_1' } }), stderr: '' };
    }
    if (args.includes('GET') && args.includes('/open-apis/im/v1/messages/om_card')) {
      return {
        stdout: JSON.stringify({
          data: { items: [{ chat_id: 'oc_1', root_id: 'om_root', thread_id: 'omt_1' }] },
        }),
        stderr: '',
      };
    }
    if (args.includes('GET') && args.includes('/open-apis/im/v1/messages')) {
      return {
        stdout: JSON.stringify({ data: { items: [{ message_id: 'om_history' }] } }),
        stderr: '',
      };
    }
    if (args.includes('POST') && args.some((arg) => String(arg).endsWith('/reactions'))) {
      return { stdout: JSON.stringify({ ok: true, data: { reaction_id: 'reaction_1' } }), stderr: '' };
    }
    return { stdout: JSON.stringify({ ok: true, data: {} }), stderr: '' };
  };
  const spawnCalls = [];
  const children = new Map();
  const channel = createLarkCliChannel({
    execFileFn,
    spawnFn: (_bin, args) => {
      spawnCalls.push(args);
      const child = new FakeChild();
      const eventKey = args[2];
      children.set(eventKey, child);
      queueMicrotask(() => child.stderr.write(`[event] ready event_key=${eventKey}\n`));
      return child;
    },
    logger: { warn() {} },
    handshakeTimeoutMs: 1000,
    now: () => 123456,
  });

  assert.equal(channel.getConnectionStatus().state, 'idle');
  await channel.connect();
  assert.equal(channel.botIdentity.openId, 'ou_bot');
  assert.equal(spawnCalls.length, 3);
  assert.deepEqual(spawnCalls[0].slice(0, 5), ['event', 'consume', 'im.message.receive_v1', '--as', 'bot']);
  assert.deepEqual(spawnCalls[1].slice(0, 5), ['event', 'consume', 'card.action.trigger', '--as', 'bot']);
  assert.deepEqual(spawnCalls[2].slice(0, 5), ['event', 'consume', 'application.bot.menu_v6', '--as', 'bot']);
  assert.deepEqual(channel.getConnectionStatus(), {
    state: 'connected',
    lastConnectTime: 123456,
    reconnectAttempts: 0,
    totalReconnects: 0,
    consumerCount: 3,
    expectedConsumerCount: 3,
  });

  children.get('im.message.receive_v1').stderr.write('[source] disconnected\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(channel.getConnectionStatus().state, 'reconnecting');
  assert.equal(channel.getConnectionStatus().totalReconnects, 1);
  children.get('im.message.receive_v1').stderr.write('[source] connected\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(channel.getConnectionStatus().state, 'connected');
  assert.equal(channel.getConnectionStatus().reconnectAttempts, 0);

  const messagePromise = once(channel, 'message');
  children.get('im.message.receive_v1').stdout.write(`${JSON.stringify({
    message_id: 'om_in',
    chat_id: 'oc_1',
    chat_type: 'p2p',
    sender_id: 'ou_user',
    sender_type: 'user',
    content: 'hello',
  })}\n`);
  const [message] = await messagePromise;
  assert.equal(message.content, 'hello');
  assert.equal(message.mentionedBot, false);

  const actionPromise = once(channel, 'cardAction');
  children.get('card.action.trigger').stdout.write(`${JSON.stringify({
    event_id: 'evt_action',
    message_id: 'om_card',
    chat_id: 'oc_1',
    operator_id: 'ou_user',
    action_tag: 'button',
    action_value: JSON.stringify({ id: 'settings:open' }),
  })}\n`);
  const [action] = await actionPromise;
  assert.equal(action.action.value.id, 'settings:open');
  assert.equal(action.rootId, 'om_root');
  assert.equal(action.threadId, 'omt_1');

  const menuPromise = once(channel, 'botMenu');
  children.get('application.bot.menu_v6').stdout.write(`${JSON.stringify({
    event_id: 'evt_menu',
    event_key: 'status',
    tenant_key: 'tenant_1',
    operator_id: 'ou_user',
    operator_name: 'User One',
  })}\n`);
  const [menu] = await menuPromise;
  assert.equal(menu.eventKey, 'status');
  assert.equal(menu.actorId, 'ou_user');

  assert.equal((await channel.send('oc_1', { text: 'out' })).messageId, 'om_sent');
  assert.equal((await channel.send('ou_user', { text: 'menu out' })).chatId, 'oc_1');
  assert.equal((await channel.send('oc_1', { card: { elements: [] } })).messageId, 'om_sent');
  assert.equal((await channel.send('oc_1', { text: 'reply' }, {
    replyTo: 'om_in',
    replyInThread: true,
  })).messageId, 'om_reply');
  await channel.editMessage('om_sent', 'done');
  await channel.updateCard('om_card', { elements: [] });
  assert.deepEqual(await channel.listMessages({
    containerIdType: 'thread',
    containerId: 'omt_1',
    limit: 10,
  }), [{ message_id: 'om_history' }]);
  await channel.recallMessage('om_root');
  assert.equal(await channel.addReaction('om_in', 'THINKING'), 'reaction_1');
  assert.equal(await channel.removeReactionByEmoji('om_in', 'THINKING'), true);

  assert.equal(calls.some((args) => args.includes('+messages-send')), true);
  assert.equal(calls.some((args) => args.includes('--user-id') && args.includes('ou_user')), true);
  assert.equal(calls.some((args) => args.includes('--msg-type') && args.includes('interactive')), true);
  assert.equal(calls.some((args) => args.includes('+messages-reply') && args.includes('--reply-in-thread')), true);
  assert.equal(calls.some((args) => args.includes('PATCH') && args.includes('/open-apis/im/v1/messages/om_sent')), true);
  assert.equal(calls.some((args) => args.includes('POST') && args.includes('/open-apis/im/v1/messages/om_in/reactions')), true);
  assert.equal(calls.some((args) => args.includes('DELETE') && args.includes('/open-apis/im/v1/messages/om_in/reactions/reaction_1')), true);
  assert.equal(calls.some((args) => args.includes('GET')
    && args.includes('/open-apis/im/v1/messages')
    && args.some((arg) => String(arg).includes('ByCreateTimeDesc'))), true);
  assert.equal(calls.some((args) => args.includes('DELETE') && args.includes('/open-apis/im/v1/messages/om_root')), true);

  await channel.disconnect();
  assert.equal(channel.getConnectionStatus().state, 'idle');
  assert.deepEqual(children.get('im.message.receive_v1').killSignals, ['SIGTERM']);
  assert.deepEqual(children.get('card.action.trigger').killSignals, ['SIGTERM']);
  assert.deepEqual(children.get('application.bot.menu_v6').killSignals, ['SIGTERM']);
});

test('Lark CLI channel rejects a ready bot identity without an open ID', async () => {
  const channel = createLarkCliChannel({
    async execFileFn() {
      return {
        stdout: JSON.stringify({
          identities: { bot: { available: true, status: 'ready' } },
        }),
      };
    },
    spawnFn() {
      throw new Error('event consumers must not start without a bot open ID');
    },
  });

  await assert.rejects(() => channel.connect(), (error) => (
    error?.code === 'permission_denied' && error?.fatal === true
  ));
});
