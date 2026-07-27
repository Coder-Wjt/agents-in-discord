import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { EventDispatcher, generateChallenge, LoggerLevel } from '@larksuiteoapi/node-sdk';

import { installLarkWebhookServer } from '../src/lark-webhook-channel.js';

function requestJson({ port, path, body, method = 'POST', headers = {} }) {
  const hasBody = body !== undefined;
  const payload = hasBody ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...(hasBody ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        } : {}),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.once('error', reject);
    request.end(hasBody ? payload : undefined);
  });
}

function encryptWebhookBody(payload, encryptKey) {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const iv = Buffer.alloc(16, 7);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function signWebhookBody(body, encryptKey, timestamp, nonce) {
  return crypto.createHash('sha256')
    .update(`${timestamp}${nonce}${encryptKey}${JSON.stringify(body)}`)
    .digest('hex');
}

function signLegacyCardBody(body, verificationToken, timestamp, nonce) {
  return crypto.createHash('sha1')
    .update(`${timestamp}${nonce}${verificationToken}${JSON.stringify(body)}`)
    .digest('hex');
}

test('Lark webhook server rejects callback and health path collisions', () => {
  assert.throws(() => installLarkWebhookServer({
    dispatcher: { async invoke() {} },
    async connect() {},
    async disconnect() {},
  }, {
    path: '/same',
    healthPath: '/same',
  }), /must differ/);
});

test('Lark webhook server handles challenges and dispatches verified request envelopes', async () => {
  const dispatched = [];
  const verified = [];
  let baseConnects = 0;
  let baseDisconnects = 0;
  let rawServer = null;
  const channel = installLarkWebhookServer({
    dispatcher: {
      encryptKey: 'encrypt-key',
      async invoke(data) {
        dispatched.push(data);
        return {
          ok: true,
          eventType: data.header?.event_type,
          signature: data.headers['x-lark-signature'],
        };
      },
    },
    async connect() { baseConnects += 1; },
    async disconnect() { baseDisconnects += 1; },
  }, {
    host: '127.0.0.1',
    port: 0,
    path: '/callbacks/lark',
    healthPath: '/readyz',
    maxBodyBytes: 1024,
    headersTimeoutMs: 4000,
    requestTimeoutMs: 6000,
    keepAliveTimeoutMs: 2000,
    createServer(handler) {
      rawServer = http.createServer(handler);
      return rawServer;
    },
    generateChallenge(data, { encryptKey }) {
      assert.equal(encryptKey, 'encrypt-key');
      return data.type === 'url_verification'
        ? { isChallenge: true, challenge: { challenge: data.challenge } }
        : { isChallenge: false, challenge: null };
    },
    async onVerifiedRequest(receipt) { verified.push(receipt); },
    logger: { log() {}, warn() {} },
    now: () => 123456,
  });

  await channel.connect();
  const status = channel.getConnectionStatus();
  assert.equal(status.state, 'connected');
  assert.equal(status.lastConnectTime, 123456);
  assert.equal(status.endpoint.path, '/callbacks/lark');
  assert.equal(status.endpoint.healthPath, '/readyz');
  assert.equal(status.endpoint.headersTimeoutMs, 4000);
  assert.equal(status.endpoint.requestTimeoutMs, 6000);
  assert.equal(status.endpoint.keepAliveTimeoutMs, 2000);
  assert.equal(status.endpoint.port > 0, true);
  assert.equal(rawServer.headersTimeout, 4000);
  assert.equal(rawServer.requestTimeout, 6000);
  assert.equal(rawServer.keepAliveTimeout, 2000);
  assert.equal(baseConnects, 1);

  assert.deepEqual(await requestJson({
    port: status.endpoint.port,
    path: '/readyz',
    method: 'GET',
  }), {
    statusCode: 200,
    body: {
      ok: true,
      platform: 'lark',
      transport: 'webhook',
      state: 'connected',
    },
  });
  assert.equal((await requestJson({
    port: status.endpoint.port,
    path: '/readyz',
    body: {},
  })).statusCode, 405);
  assert.equal((await requestJson({
    port: status.endpoint.port,
    path: '/callbacks/lark',
    method: 'GET',
  })).statusCode, 405);

  assert.deepEqual(await requestJson({
    port: status.endpoint.port,
    path: '/callbacks/lark',
    body: { type: 'url_verification', challenge: 'challenge-1' },
  }), {
    statusCode: 200,
    body: { challenge: 'challenge-1' },
  });
  assert.equal(dispatched.length, 0);
  assert.deepEqual(verified, [{ challenge: true, encrypted: false, signed: false }]);

  assert.deepEqual(await requestJson({
    port: status.endpoint.port,
    path: '/callbacks/lark',
    body: { header: { event_type: 'im.message.receive_v1' }, event: {} },
    headers: { 'x-lark-signature': 'signature-1' },
  }), {
    statusCode: 200,
    body: {
      ok: true,
      eventType: 'im.message.receive_v1',
      signature: 'signature-1',
    },
  });
  assert.equal(dispatched.length, 1);
  assert.deepEqual(verified, [
    { challenge: true, encrypted: false, signed: false },
    { challenge: false, encrypted: false, signed: false },
  ]);

  assert.equal((await requestJson({
    port: status.endpoint.port,
    path: '/wrong',
    body: {},
  })).statusCode, 404);
  assert.equal((await requestJson({
    port: status.endpoint.port,
    path: '/callbacks/lark',
    body: { text: 'x'.repeat(2048) },
  })).statusCode, 413);

  await channel.disconnect();
  assert.equal(channel.getConnectionStatus().state, 'idle');
  assert.equal(baseDisconnects, 1);
});

test('Lark webhook server returns a generic rejection for dispatcher verification failures', async () => {
  const warnings = [];
  const verified = [];
  const channel = installLarkWebhookServer({
    dispatcher: {
      encryptKey: '',
      async invoke() { throw new Error('verification token mismatch: secret detail'); },
    },
    async connect() {},
    async disconnect() {},
  }, {
    host: '127.0.0.1',
    port: 0,
    async onVerifiedRequest(receipt) { verified.push(receipt); },
    logger: { log() {}, warn(message) { warnings.push(message); } },
  });
  await channel.connect();
  const response = await requestJson({
    port: channel.getConnectionStatus().endpoint.port,
    path: '/lark/events',
    body: { event: {} },
  });
  assert.deepEqual(response, {
    statusCode: 400,
    body: { ok: false, error: 'invalid webhook request' },
  });
  assert.deepEqual(warnings, ['Lark webhook request rejected.']);
  assert.deepEqual(verified, []);
  assert.doesNotMatch(warnings[0], /secret detail|verification token mismatch/i);
  await channel.disconnect();
});

test('Lark webhook server verifies signatures, validates tokens, and decrypts official dispatcher events', async () => {
  const verificationToken = 'verification-token';
  const encryptKey = 'encrypt-key';
  const dispatcher = new EventDispatcher({
    verificationToken,
    encryptKey,
    loggerLevel: LoggerLevel.fatal,
  });
  dispatcher.register({
    'test.event': async (event) => ({ ok: true, value: event.value }),
  });
  const verified = [];
  const channel = installLarkWebhookServer({
    dispatcher,
    async connect() {},
    async disconnect() {},
  }, {
    host: '127.0.0.1',
    port: 0,
    generateChallenge,
    async onVerifiedRequest(receipt) { verified.push(receipt); },
    logger: { log() {}, warn() {} },
  });
  await channel.connect();
  const port = channel.getConnectionStatus().endpoint.port;
  const timestamp = '1785070000';
  const nonce = 'nonce-1';
  const unsignedChallengeBody = {
    encrypt: encryptWebhookBody({
      type: 'url_verification',
      token: verificationToken,
      challenge: 'encrypted-challenge',
    }, encryptKey),
  };

  assert.deepEqual(await requestJson({
    port,
    path: '/lark/events',
    body: unsignedChallengeBody,
  }), {
    statusCode: 200,
    body: { challenge: 'encrypted-challenge' },
  });
  assert.deepEqual(verified, [{ challenge: true, encrypted: true, signed: false }]);

  assert.equal((await requestJson({
    port,
    path: '/lark/events',
    body: unsignedChallengeBody,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': 'invalid-signature',
    },
  })).statusCode, 400);

  const encrypted = encryptWebhookBody({
    schema: '2.0',
    header: {
      event_type: 'test.event',
      token: verificationToken,
    },
    event: { value: 42 },
  }, encryptKey);
  const body = { encrypt: encrypted };
  const signature = signWebhookBody(body, encryptKey, timestamp, nonce);

  assert.deepEqual(await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signature,
    },
  }), {
    statusCode: 200,
    body: { ok: true, value: 42 },
  });
  assert.deepEqual(verified, [
    { challenge: true, encrypted: true, signed: false },
    { challenge: false, encrypted: true, signed: true },
  ]);

  assert.deepEqual(await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': 'invalid-signature',
    },
  }), {
    statusCode: 400,
    body: { ok: false, error: 'invalid webhook request' },
  });

  const wrongTokenBody = {
    encrypt: encryptWebhookBody({
      schema: '2.0',
      header: { event_type: 'test.event', token: 'wrong-token' },
      event: { value: 99 },
    }, encryptKey),
  };
  assert.equal((await requestJson({
    port,
    path: '/lark/events',
    body: wrongTokenBody,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signWebhookBody(wrongTokenBody, encryptKey, timestamp, nonce),
    },
  })).statusCode, 400);
  assert.deepEqual(verified, [
    { challenge: true, encrypted: true, signed: false },
    { challenge: false, encrypted: true, signed: true },
  ]);

  await channel.disconnect();
});

test('Lark webhook server verifies and dispatches legacy Card 1.0 actions', async () => {
  const verificationToken = 'legacy-card-token';
  const encryptKey = 'legacy-card-encrypt-key';
  const dispatcher = new EventDispatcher({
    verificationToken,
    encryptKey,
    loggerLevel: LoggerLevel.fatal,
  });
  const actions = [];
  const verified = [];
  const warnings = [];
  const channel = installLarkWebhookServer({
    dispatcher,
    handlers: {
      async cardAction(event) {
        actions.push(event);
        return {
          ok: true,
          messageId: event.messageId,
          actorId: event.operator?.openId,
          option: event.action?.option,
        };
      },
    },
    async connect() {},
    async disconnect() {},
  }, {
    host: '127.0.0.1',
    port: 0,
    async onVerifiedRequest(receipt) { verified.push(receipt); },
    logger: { log() {}, warn(message) { warnings.push(message); } },
  });
  await channel.connect();
  const port = channel.getConnectionStatus().endpoint.port;
  const timestamp = '1785070100';
  const nonce = 'legacy-card-nonce';
  const body = {
    open_id: 'ou_legacy_user',
    user_id: 'legacy-user-id',
    open_message_id: 'om_settings_card',
    tenant_key: 'tenant-legacy',
    token: verificationToken,
    action: {
      tag: 'select_static',
      option: 'language',
      value: { id: 'settings:section' },
    },
  };

  assert.deepEqual(await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signLegacyCardBody(body, verificationToken, timestamp, nonce),
    },
  }), {
    statusCode: 200,
    body: {
      ok: true,
      messageId: 'om_settings_card',
      actorId: 'ou_legacy_user',
      option: 'language',
    },
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].chatId, undefined);
  assert.equal(actions[0].tenantId, 'tenant-legacy');
  assert.equal(actions[0].raw.event_id, `legacy-card:${timestamp}:${nonce}`);
  assert.deepEqual(verified, [{ challenge: false, encrypted: false, signed: true }]);
  assert.deepEqual(warnings, []);

  assert.deepEqual(await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': 'invalid-signature',
    },
  }), {
    statusCode: 400,
    body: { ok: false, error: 'invalid webhook request' },
  });
  assert.equal(actions.length, 1);
  assert.deepEqual(verified, [{ challenge: false, encrypted: false, signed: true }]);
  assert.deepEqual(warnings, ['Lark webhook request rejected (verification_failed).']);

  await channel.disconnect();
});

test('Lark webhook server keeps schema Card 2.0 actions on SHA-256 event verification', async () => {
  const verificationToken = 'schema-card-token';
  const encryptKey = 'schema-card-encrypt-key';
  const dispatcher = new EventDispatcher({
    verificationToken,
    encryptKey,
    loggerLevel: LoggerLevel.fatal,
  });
  let actionCount = 0;
  dispatcher.register({
    'card.action.trigger': async () => {
      actionCount += 1;
      return { ok: true };
    },
  });
  const channel = installLarkWebhookServer({
    dispatcher,
    async connect() {},
    async disconnect() {},
  }, {
    host: '127.0.0.1',
    port: 0,
    logger: { log() {}, warn() {} },
  });
  await channel.connect();
  const port = channel.getConnectionStatus().endpoint.port;
  const timestamp = '1785070200';
  const nonce = 'schema-card-nonce';
  const body = {
    schema: '2.0',
    header: {
      event_type: 'card.action.trigger',
      token: verificationToken,
      event_id: 'evt_schema_card',
    },
    event: {
      context: {
        open_message_id: 'om_schema_card',
        open_chat_id: 'oc_schema_chat',
      },
      operator: { open_id: 'ou_schema_user' },
      action: { tag: 'button', value: { id: 'settings:open' } },
    },
  };

  assert.equal((await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signLegacyCardBody(body, verificationToken, timestamp, nonce),
    },
  })).statusCode, 400);
  assert.equal(actionCount, 0);

  assert.deepEqual(await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signWebhookBody(body, encryptKey, timestamp, nonce),
    },
  }), {
    statusCode: 200,
    body: { ok: true },
  });
  assert.equal(actionCount, 1);

  await channel.disconnect();
});

test('Lark webhook server accepts encrypted legacy card actions after SHA-256 authentication', async () => {
  const verificationToken = 'event-verification-token';
  const encryptKey = 'encrypted-legacy-card-key';
  const dispatcher = new EventDispatcher({
    verificationToken,
    encryptKey,
    loggerLevel: LoggerLevel.fatal,
  });
  const actions = [];
  const channel = installLarkWebhookServer({
    dispatcher,
    handlers: {
      async cardAction(event) {
        actions.push(event);
        return { ok: true, option: event.action?.option };
      },
    },
    async connect() {},
    async disconnect() {},
  }, {
    host: '127.0.0.1',
    port: 0,
    logger: { log() {}, warn() {} },
  });
  await channel.connect();
  const port = channel.getConnectionStatus().endpoint.port;
  const timestamp = '1785070300';
  const nonce = 'encrypted-legacy-card-nonce';
  const body = {
    encrypt: encryptWebhookBody({
      open_id: 'ou_encrypted_card_user',
      user_id: 'encrypted-card-user-id',
      open_message_id: 'om_encrypted_settings_card',
      tenant_key: 'tenant-encrypted-card',
      token: 'card-callback-token-differs-from-event-token',
      action: {
        tag: 'select_static',
        option: 'language',
        value: { id: 'settings:section' },
      },
    }, encryptKey),
  };

  assert.deepEqual(await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signWebhookBody(body, encryptKey, timestamp, nonce),
    },
  }), {
    statusCode: 200,
    body: { ok: true, option: 'language' },
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].messageId, 'om_encrypted_settings_card');
  assert.equal(actions[0].raw.event_id, `legacy-card:${timestamp}:${nonce}`);

  assert.equal((await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': 'invalid-signature',
    },
  })).statusCode, 400);
  assert.equal(actions.length, 1);

  await channel.disconnect();
});

test('Lark webhook server returns legacy card updates in the callback response', async () => {
  const verificationToken = 'legacy-card-response-token';
  const dispatcher = new EventDispatcher({
    verificationToken,
    loggerLevel: LoggerLevel.fatal,
  });
  const updatedCard = {
    elements: [{
      tag: 'action',
      actions: [
        { tag: 'button', text: { tag: 'plain_text', content: '中文' }, value: { id: 'language:zh' } },
        { tag: 'button', text: { tag: 'plain_text', content: 'English' }, value: { id: 'language:en' } },
      ],
    }],
  };
  const apiUpdates = [];
  let channel;
  channel = installLarkWebhookServer({
    dispatcher,
    handlers: {
      async cardAction(event) {
        await channel.updateCard(event.messageId, updatedCard);
      },
    },
    async updateCard(messageId, card) {
      apiUpdates.push({ messageId, card });
    },
    async connect() {},
    async disconnect() {},
  }, {
    host: '127.0.0.1',
    port: 0,
    logger: { log() {}, warn() {} },
  });
  await channel.connect();
  const port = channel.getConnectionStatus().endpoint.port;
  const timestamp = '1785070400';
  const nonce = 'legacy-card-response-nonce';
  const body = {
    open_id: 'ou_legacy_response_user',
    open_message_id: 'om_legacy_response_card',
    tenant_key: 'tenant-legacy-response',
    token: verificationToken,
    action: {
      tag: 'select_static',
      option: 'language',
      value: { id: 'settings:section' },
    },
  };

  assert.deepEqual(await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signLegacyCardBody(body, verificationToken, timestamp, nonce),
    },
  }), {
    statusCode: 200,
    body: updatedCard,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(apiUpdates, [{
    messageId: 'om_legacy_response_card',
    card: updatedCard,
  }]);

  await channel.updateCard('om_outside_callback', { elements: [] });
  assert.deepEqual(apiUpdates, [
    {
      messageId: 'om_legacy_response_card',
      card: updatedCard,
    },
    {
      messageId: 'om_outside_callback',
      card: { elements: [] },
    },
  ]);

  await channel.disconnect();
});

test('Lark webhook server replies to legacy card actions before the persistent card PATCH completes', async () => {
  const verificationToken = 'legacy-card-fast-response-token';
  const dispatcher = new EventDispatcher({
    verificationToken,
    loggerLevel: LoggerLevel.fatal,
  });
  const updatedCard = {
    config: { update_multi: true },
    elements: [{
      tag: 'action',
      actions: [
        { tag: 'button', text: { tag: 'plain_text', content: '中文' }, value: { id: 'language:zh' } },
        { tag: 'button', text: { tag: 'plain_text', content: 'English' }, value: { id: 'language:en' } },
      ],
    }],
  };
  let resolvePersistentUpdate;
  let persistentUpdateStarted = false;
  const persistentUpdate = new Promise((resolve) => {
    resolvePersistentUpdate = resolve;
  });
  let channel;
  channel = installLarkWebhookServer({
    dispatcher,
    handlers: {
      async cardAction(event) {
        await channel.updateCard(event.messageId, updatedCard);
      },
    },
    async updateCard() {
      persistentUpdateStarted = true;
      await persistentUpdate;
    },
    async connect() {},
    async disconnect() {},
  }, {
    host: '127.0.0.1',
    port: 0,
    logger: { log() {}, warn() {} },
  });
  await channel.connect();
  const port = channel.getConnectionStatus().endpoint.port;
  const timestamp = '1785070500';
  const nonce = 'legacy-card-fast-response-nonce';
  const body = {
    open_id: 'ou_legacy_fast_response_user',
    open_message_id: 'om_legacy_fast_response_card',
    tenant_key: 'tenant-legacy-fast-response',
    token: verificationToken,
    action: {
      tag: 'select_static',
      option: 'language',
      value: { id: 'settings:section' },
    },
  };

  const response = await requestJson({
    port,
    path: '/lark/events',
    body,
    headers: {
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': signLegacyCardBody(body, verificationToken, timestamp, nonce),
    },
  });

  assert.deepEqual(response, { statusCode: 200, body: updatedCard });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persistentUpdateStarted, true);
  resolvePersistentUpdate();
  await persistentUpdate;
  await channel.disconnect();
});
