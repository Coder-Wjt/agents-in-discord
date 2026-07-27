import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createWechatSessionStore,
  readCodexSessionPreview,
} from '../src/wechat/session-store.js';

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-wechat-session-'));
  const projectA = path.join(root, 'a');
  const projectB = path.join(root, 'b');
  fs.mkdirSync(projectA);
  fs.mkdirSync(projectB);
  const sessions = [
    { id: 'session-a', mtime: 200 },
    { id: 'session-b', mtime: 100 },
  ];
  const meta = {
    'session-a': { cwd: projectA, mtimeMs: 200, file: null },
    'session-b': { cwd: projectB, mtimeMs: 100, file: null },
  };
  const store = createWechatSessionStore({
    dataFile: path.join(root, 'sessions.json'),
    defaultWorkspaceDir: projectA,
    workspaceRoots: [root],
    listRecentSessionsFn: () => sessions,
    readSessionMetaFn: (id) => meta[id] || null,
  });
  return { root, projectA, projectB, store };
}

test('wechat session store lists and binds a real session selection by number', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const items = fixture.store.listRecent('user-1');
  assert.equal(items.length, 2);
  const session = fixture.store.bind('user-1', '2');

  assert.equal(session.sessionId, 'session-b');
  assert.equal(session.workspaceDir, fixture.projectB);
});

test('wechat session store clears the session when workspace changes', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  fixture.store.bind('user-1', 'session-a');
  const session = fixture.store.setWorkspace('user-1', fixture.projectB);

  assert.equal(session.sessionId, null);
  assert.equal(session.workspaceDir, fixture.projectB);
});

test('wechat session store rejects workspaces outside configured roots', (t) => {
  const fixture = createFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-wechat-outside-'));
  t.after(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  assert.throws(
    () => fixture.store.setWorkspace('user-1', outside),
    /WECHAT_WORKSPACE_ROOTS/,
  );
});

test('readCodexSessionPreview uses the first real user message', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-wechat-preview-'));
  const file = path.join(root, 'rollout.jsonl');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(file, [
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'user_message', message: '<environment_context>hidden</environment_context>' },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'user_message', message: '帮我修复登录流程\n并运行测试' },
    }),
  ].join('\n'));

  assert.equal(readCodexSessionPreview(file), '帮我修复登录流程 并运行测试');
});
