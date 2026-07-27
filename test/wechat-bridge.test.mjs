import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWechatBridge,
  formatWechatSessionList,
} from '../src/wechat/bridge.js';

function createFixture() {
  const replies = [];
  let handler = null;
  let session = {
    sessionId: null,
    workspaceDir: '/tmp/project',
    model: null,
    effort: null,
    mode: 'safe',
  };
  const ilink = {
    onMessage(fn) {
      handler = fn;
    },
    async sendText(userId, text) {
      replies.push({ userId, text });
    },
    async startTyping() {
      return () => {};
    },
  };
  const sessionStore = {
    get: () => session,
    listRecent: () => [{
      id: 'thread-1',
      workspaceDir: '/tmp/project',
      mtime: Date.now(),
    }],
    bind: (_userId, selector) => {
      session = { ...session, sessionId: selector === '1' ? 'thread-1' : selector };
      return session;
    },
    startNew: () => {
      session = { ...session, sessionId: null };
      return session;
    },
    setWorkspace: (_userId, workspaceDir) => {
      session = { ...session, workspaceDir, sessionId: null };
      return session;
    },
    update: (_userId, patch) => {
      session = { ...session, ...patch };
      return session;
    },
  };
  let active = false;
  const codexRuntime = {
    getActive: () => (active ? { running: true } : null),
    cancel: () => ({ cancelled: false }),
    async run() {
      return {
        ok: true,
        text: '完成',
        sessionId: 'thread-new',
        workspaceDir: '/tmp/project',
      };
    },
  };
  const bridge = createWechatBridge({
    ilink,
    sessionStore,
    codexRuntime,
    allowedUserIds: ['allowed'],
  });
  return {
    bridge,
    getHandler: () => handler,
    replies,
    setActive: (value) => {
      active = value;
    },
  };
}

test('formatWechatSessionList marks the current selection', () => {
  const text = formatWechatSessionList([{
    id: 'thread-1',
    workspaceDir: '/tmp/project',
    mtime: 1000,
    preview: 'Fix login',
  }], 'thread-1', 2000);
  assert.match(text, /\[当前\]/);
  assert.match(text, /Fix login/);
  assert.match(text, /\/resume <编号>/);
});

test('wechat bridge lists and binds sessions through text commands', async () => {
  const fixture = createFixture();
  await fixture.bridge.handleCommand('allowed', '/sessions');
  await fixture.bridge.handleCommand('allowed', '/resume 1');

  assert.match(fixture.replies[0].text, /thread-1/);
  assert.match(fixture.replies[1].text, /已绑定 Codex 会话/);
});

test('wechat bridge ignores unauthorized users', async () => {
  const fixture = createFixture();
  await fixture.getHandler()(
    { from_user_id: 'denied' },
    { text: 'run this', quotedText: '', unsupportedMedia: 0 },
  );
  assert.equal(fixture.replies.length, 0);
});

test('wechat bridge sends a prompt result with the real session id', async () => {
  const fixture = createFixture();
  await fixture.bridge.handlePrompt('allowed', 'run this');

  assert.match(fixture.replies[0].text, /完成/);
  assert.match(fixture.replies[0].text, /thread-new/);
});

test('wechat bridge keeps dangerous mode disabled unless explicitly configured', async () => {
  const fixture = createFixture();
  await assert.rejects(
    fixture.bridge.handleCommand('allowed', '/mode dangerous'),
    /WECHAT_ALLOW_DANGEROUS/,
  );
});

test('wechat bridge does not change session binding while a task is active', async () => {
  const fixture = createFixture();
  fixture.setActive(true);

  await assert.rejects(
    fixture.bridge.handleCommand('allowed', '/resume 1'),
    /当前任务仍在运行/,
  );
});
