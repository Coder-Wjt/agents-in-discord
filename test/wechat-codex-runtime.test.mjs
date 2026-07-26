import assert from 'node:assert/strict';
import test from 'node:test';

import { createWechatCodexRuntime } from '../src/wechat/codex-runtime.js';

test('wechat Codex runtime persists the real thread id returned by the shared runner', async () => {
  const updates = [];
  const sessionStore = {
    get: () => ({
      sessionId: 'thread-old',
      workspaceDir: '/tmp/project',
      model: null,
      effort: null,
      mode: 'safe',
    }),
    update: (userId, patch) => updates.push({ userId, patch }),
  };
  const lock = {
    released: false,
    release() {
      this.released = true;
    },
  };
  const runtime = createWechatCodexRuntime({
    sessionStore,
    runnerExecutor: {
      async runProviderTask(options) {
        assert.equal(options.session.sessionId, 'thread-old');
        assert.equal(options.sessionKey, 'wechat:dm:user-1');
        return {
          ok: true,
          threadId: 'thread-new',
          finalAnswerMessages: ['done'],
          messages: [],
        };
      },
      closeAllRuntimeSessions() {},
    },
    workspaceRuntime: {
      acquireWorkspace: async () => lock,
      readLock: () => ({ owner: null }),
    },
  });

  const result = await runtime.run('user-1', 'run this');

  assert.equal(result.ok, true);
  assert.equal(result.text, 'done');
  assert.equal(result.sessionId, 'thread-new');
  assert.deepEqual(updates, [{
    userId: 'user-1',
    patch: { sessionId: 'thread-new' },
  }]);
  assert.equal(lock.released, true);
});
