import test from 'node:test';
import assert from 'node:assert/strict';

import { createLarkLifecycle } from '../src/lark-lifecycle.js';

test('Lark lifecycle binds, connects, and replaces the channel during restart', async () => {
  const clients = [];
  const bound = [];
  function createClient() {
    const client = {
      connected: 0,
      disconnected: 0,
      async connect() { this.connected += 1; },
      async disconnect() { this.disconnected += 1; },
    };
    clients.push(client);
    return client;
  }
  const lifecycle = createLarkLifecycle({
    createClient,
    bindClientHandlers: (client) => bound.push(client),
    transport: 'cli',
    logger: { log() {}, warn() {}, error() {} },
    processRef: { on() {}, once() {} },
    now: () => 1000,
  });

  assert.equal(await lifecycle.bootClient('test'), clients[0]);
  assert.equal(clients[0].connected, 1);
  assert.equal(bound.length, 1);
  assert.deepEqual(lifecycle.getHealthSnapshot(), {
    available: true,
    transport: 'cli',
    state: 'connected',
    connected: true,
    connectAttempts: 1,
    connectRetries: 0,
    reconnectAttempts: 0,
    totalReconnects: null,
    selfHealRestarts: 0,
    selfHealScheduled: false,
    selfHealInFlight: false,
    lastReason: 'test',
    lastConnectAt: 1000,
    lastConnectedAt: 1000,
    nextReconnectAt: null,
    lastError: null,
    statusError: null,
  });
  assert.equal(await lifecycle.restartClient('test-restart'), clients[1]);
  assert.equal(clients[0].disconnected, 1);
  assert.equal(clients[1].connected, 1);
  assert.equal(bound.length, 2);
  assert.equal(lifecycle.getHealthSnapshot().selfHealRestarts, 1);
  assert.equal(lifecycle.getHealthSnapshot().connectAttempts, 2);
});

test('Lark lifecycle fails fast for SDK-wrapped credential errors', async () => {
  let sleepCalls = 0;
  const lifecycle = createLarkLifecycle({
    createClient: () => ({
      async connect() {
        const error = new Error('could not resolve bot identity');
        error.code = 'not_connected';
        error.cause = new Error('failed to get tenant_access_token, code: 10003, msg: invalid param');
        throw error;
      },
    }),
    bindClientHandlers() {},
    sleep: async () => { sleepCalls += 1; },
    logger: { log() {}, warn() {}, error() {} },
    processRef: { on() {}, once() {} },
  });

  await assert.rejects(() => lifecycle.bootClient('invalid-credentials'), /could not resolve bot identity/);
  assert.equal(sleepCalls, 0);
});

test('Lark lifecycle fails fast for transport-declared fatal errors', async () => {
  let sleepCalls = 0;
  const lifecycle = createLarkLifecycle({
    createClient: () => ({
      async connect() {
        const error = new Error('lark-cli is not configured');
        error.fatal = true;
        throw error;
      },
    }),
    bindClientHandlers() {},
    sleep: async () => { sleepCalls += 1; },
    logger: { log() {}, warn() {}, error() {} },
    processRef: { on() {}, once() {} },
  });

  await assert.rejects(() => lifecycle.bootClient('fatal-transport'), /not configured/);
  assert.equal(sleepCalls, 0);
  assert.equal(lifecycle.getHealthSnapshot().state, 'failed');
  assert.equal(lifecycle.getHealthSnapshot().lastError.error, 'lark-cli is not configured');
});

test('Lark lifecycle keeps graceful signal shutdown when self-heal is disabled', async () => {
  const persistentHandlers = new Map();
  const oneShotHandlers = new Map();
  const cancelReasons = [];
  const exits = [];
  const logs = [];
  let disconnectCalls = 0;
  const lifecycle = createLarkLifecycle({
    createClient: () => ({
      async connect() {},
      async disconnect() { disconnectCalls += 1; },
    }),
    bindClientHandlers() {},
    cancelAllChannelWork(reason) { cancelReasons.push(reason); },
    selfHealEnabled: false,
    logger: { log(message) { logs.push(String(message)); }, warn() {}, error() {} },
    processRef: {
      on(name, handler) { persistentHandlers.set(name, handler); },
      once(name, handler) { oneShotHandlers.set(name, handler); },
      exit(code) { exits.push(code); },
    },
  });

  await lifecycle.bootClient('test');
  lifecycle.setupProcessSelfHeal();
  lifecycle.setupProcessSelfHeal();

  assert.deepEqual([...persistentHandlers.keys()], []);
  assert.deepEqual([...oneShotHandlers.keys()].sort(), ['SIGINT', 'SIGTERM']);
  oneShotHandlers.get('SIGTERM')();
  await lifecycle.shutdownClient('test-await');

  assert.deepEqual(cancelReasons, ['SIGTERM']);
  assert.equal(disconnectCalls, 1);
  assert.deepEqual(exits, [0]);
  assert.equal(logs.some((line) => line.includes('shutdown started (reason=SIGTERM)')), true);
  assert.equal(logs.some((line) => line.includes('active work cancellation complete (reason=SIGTERM)')), true);
  assert.equal(logs.some((line) => line.includes('shutdown complete (reason=SIGTERM)')), true);
  assert.equal(lifecycle.getHealthSnapshot().state, 'idle');
  assert.equal(lifecycle.getHealthSnapshot().lastReason, 'SIGTERM');
});

test('Lark signal shutdown waits for active work cancellation before disconnect and exit', async () => {
  const oneShotHandlers = new Map();
  const events = [];
  let releaseCancellation;
  const cancellation = new Promise((resolve) => { releaseCancellation = resolve; });
  const lifecycle = createLarkLifecycle({
    createClient: () => ({
      async connect() {},
      async disconnect() { events.push('disconnect'); },
    }),
    bindClientHandlers() {},
    cancelAllChannelWork() {
      events.push('cancel-start');
      return cancellation.then(() => {
        events.push('cancel-complete');
        return [{ exited: true, forced: true }];
      });
    },
    selfHealEnabled: false,
    logger: { log() {}, warn() {}, error() {} },
    processRef: {
      on() {},
      once(name, handler) { oneShotHandlers.set(name, handler); },
      exit(code) { events.push(`exit:${code}`); },
    },
  });

  await lifecycle.bootClient('test');
  lifecycle.setupProcessSelfHeal();
  oneShotHandlers.get('SIGTERM')();
  await Promise.resolve();

  assert.deepEqual(events, ['cancel-start']);
  releaseCancellation();
  await lifecycle.shutdownClient('await-test');

  assert.deepEqual(events, ['cancel-start', 'cancel-complete', 'disconnect', 'exit:0']);
});

test('Lark lifecycle clears pending self-heal and suppresses restarts during shutdown', async () => {
  const timers = [];
  const cleared = [];
  let clientCount = 0;
  const lifecycle = createLarkLifecycle({
    createClient: () => {
      clientCount += 1;
      return {
        async connect() {},
        async disconnect() {},
      };
    },
    bindClientHandlers() {},
    logger: { log() {}, warn() {}, error() {} },
    processRef: { on() {}, once() {} },
    setTimeoutFn(callback) {
      const timer = { callback, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) { cleared.push(timer); },
  });

  await lifecycle.bootClient('test');
  lifecycle.scheduleSelfHeal('connection_error', new Error('temporary failure'));
  assert.equal(lifecycle.getHealthSnapshot().selfHealScheduled, true);

  await lifecycle.shutdownClient('SIGINT');
  assert.deepEqual(cleared, [timers[0]]);
  assert.equal(lifecycle.getHealthSnapshot().selfHealScheduled, false);
  timers[0].callback();
  await Promise.resolve();

  assert.equal(clientCount, 1);
  assert.equal(lifecycle.getHealthSnapshot().selfHealRestarts, 0);
});

test('Lark lifecycle contains disconnect errors instead of scheduling recovery while exiting', async () => {
  const errors = [];
  const timers = [];
  const lifecycle = createLarkLifecycle({
    createClient: () => ({
      async connect() {},
      async disconnect() { throw new Error('close failed with private detail'); },
    }),
    bindClientHandlers() {},
    logger: { log() {}, warn() {}, error(message) { errors.push(String(message)); } },
    processRef: { on() {}, once() {} },
    setTimeoutFn(callback) {
      timers.push(callback);
      return { unref() {} };
    },
  });

  await lifecycle.bootClient('test');
  await lifecycle.shutdownClient('SIGTERM');

  assert.equal(timers.length, 0);
  assert.equal(lifecycle.getHealthSnapshot().state, 'idle');
  assert.equal(lifecycle.getHealthSnapshot().selfHealScheduled, false);
  assert.equal(lifecycle.getHealthSnapshot().lastError.error, 'close failed with private detail');
  assert.equal(errors.some((line) => line.includes('disconnect failed during SIGTERM')), true);
});

test('Lark lifecycle interrupts retry backoff when shutdown begins', async () => {
  let connectCalls = 0;
  let disconnectCalls = 0;
  let retryStarted;
  const retryStartedPromise = new Promise((resolve) => { retryStarted = resolve; });
  const lifecycle = createLarkLifecycle({
    createClient: () => ({
      async connect() {
        connectCalls += 1;
        throw new Error('temporary network failure');
      },
      async disconnect() { disconnectCalls += 1; },
    }),
    bindClientHandlers() {},
    logger: { log() {}, warn() {}, error() {} },
    processRef: { on() {}, once() {} },
    sleep: async (_ms, { signal }) => new Promise((resolve) => {
      retryStarted();
      signal.addEventListener('abort', () => resolve(false), { once: true });
    }),
  });

  const bootPromise = lifecycle.bootClient('test');
  await retryStartedPromise;
  await lifecycle.shutdownClient('SIGTERM');

  await assert.rejects(bootPromise, (error) => error?.code === 'lark_lifecycle_shutdown');
  assert.equal(connectCalls, 1);
  assert.equal(disconnectCalls, 1);
  assert.equal(lifecycle.getHealthSnapshot().state, 'idle');
});
