import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Domain,
  LoggerLevel,
  createLarkChannel,
  normalizeCardAction,
} from '@larksuiteoapi/node-sdk';
import { installLarkSdkBotMenuSupport } from '../src/platforms/lark/bot-menu.js';

test('official Lark SDK composes the WebSocket channel on Node.js 18', async () => {
  assert.equal(Number(process.versions.node.split('.')[0]) >= 18, true);
  const channel = createLarkChannel({
    appId: 'cli_node18_smoke',
    appSecret: 'node18-smoke-secret',
    transport: 'websocket',
    domain: Domain.Feishu,
    loggerLevel: LoggerLevel.fatal,
  });

  assert.equal(typeof channel.connect, 'function');
  assert.equal(typeof channel.disconnect, 'function');
  assert.equal(typeof channel.getConnectionStatus, 'function');
  assert.equal(typeof channel.send, 'function');
  assert.equal(typeof channel.downloadResource, 'function');
  await channel.disconnect();
});

test('official Lark SDK raw card actions retain Card 2.0 form values', () => {
  const event = normalizeCardAction({
    context: {
      open_message_id: 'om_card',
      open_chat_id: 'oc_1',
    },
    operator: { open_id: 'ou_user' },
    action: {
      tag: 'button',
      name: 'aid_modal_submit:stgm:model:ou_user',
      form_value: { model_name: 'gpt-5.6' },
    },
  }, { includeRaw: true });

  assert.equal(event.action.name, 'aid_modal_submit:stgm:model:ou_user');
  assert.deepEqual(event.raw.action.form_value, { model_name: 'gpt-5.6' });
});

test('official Lark SDK webhook dispatcher retains verification and encryption settings', async () => {
  const channel = createLarkChannel({
    appId: 'cli_webhook_smoke',
    appSecret: 'webhook-smoke-secret',
    transport: 'webhook',
    webhook: {
      verificationToken: 'verification-token',
      encryptKey: 'encrypt-key',
    },
    domain: Domain.Feishu,
    loggerLevel: LoggerLevel.fatal,
  });

  assert.equal(channel.dispatcher.verificationToken, 'verification-token');
  assert.equal(channel.dispatcher.encryptKey, 'encrypt-key');
  await channel.disconnect();
});

test('Lark SDK extension dispatches native bot menu events', async () => {
  const channel = installLarkSdkBotMenuSupport(createLarkChannel({
    appId: 'cli_menu_smoke',
    appSecret: 'menu-smoke-secret',
    transport: 'websocket',
    domain: Domain.Feishu,
    loggerLevel: LoggerLevel.fatal,
  }));
  const events = [];
  channel.on('botMenu', (event) => events.push(event));

  await channel.dispatcher.invoke({
    schema: '2.0',
    header: {
      event_type: 'application.bot.menu_v6',
      event_id: 'evt_menu',
      tenant_key: 'tenant_1',
    },
    event: {
      event_key: 'status',
      operator: {
        operator_name: 'User One',
        operator_id: { open_id: 'ou_user' },
      },
    },
  }, { needCheck: false });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventKey, 'status');
  assert.equal(events[0].actorId, 'ou_user');
  await channel.disconnect();
});

test('Lark SDK extension resolves the direct-chat id after sending to an open id', async () => {
  const registered = {};
  const fakeChannel = {
    dispatcher: {
      register(handlers) {
        Object.assign(registered, handlers);
      },
    },
    on() {
      return () => {};
    },
    async send(to, input) {
      assert.equal(to, 'ou_user');
      assert.deepEqual(input, { text: 'hello' });
      return { messageId: 'om_dm' };
    },
    rawClient: {
      im: {
        v1: {
          message: {
            async get({ path }) {
              assert.equal(path.message_id, 'om_dm');
              return { data: { items: [{ chat_id: 'oc_dm' }] } };
            },
          },
        },
      },
    },
  };

  installLarkSdkBotMenuSupport(fakeChannel);
  const result = await fakeChannel.send('ou_user', { text: 'hello' });

  assert.equal(typeof registered['application.bot.menu_v6'], 'function');
  assert.deepEqual(result, { messageId: 'om_dm', chatId: 'oc_dm' });
});

test('Lark SDK extension enriches card actions with reply-chain context', async () => {
  const listeners = {};
  const fakeChannel = {
    dispatcher: { register() {} },
    on(name, handler) {
      listeners[name] = handler;
      return () => {};
    },
    rawClient: {
      im: {
        v1: {
          message: {
            async get({ path }) {
              assert.equal(path.message_id, 'om_card');
              return {
                data: {
                  items: [{ chat_id: 'oc_1', root_id: 'om_root', thread_id: 'omt_1' }],
                },
              };
            },
          },
        },
      },
    },
  };
  installLarkSdkBotMenuSupport(fakeChannel);
  let received = null;
  fakeChannel.on('cardAction', (event) => { received = event; });

  await listeners.cardAction({ messageId: 'om_card', chatId: 'oc_1' });

  assert.equal(received.rootId, 'om_root');
  assert.equal(received.threadId, 'omt_1');
});
