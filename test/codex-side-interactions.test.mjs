import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { createCodexSideInteractionSurface } from '../src/codex-side-interactions.js';

function createSurface(overrides = {}) {
  return createCodexSideInteractionSurface({
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    getSessionId: (session) => session?.runnerSessionId || null,
    getSessionProvider: (session) => session?.provider || 'codex',
    getSessionLanguage: (session) => session?.language || 'zh',
    resolveRuntimeModeSetting: () => ({ mode: 'long', supported: true }),
    resolveCodexProfileSetting: () => ({ isExplicit: false }),
    getRuntimeSnapshot: () => ({ running: true, queued: 0 }),
    ...overrides,
  });
}

test('side interaction opens the question modal, creates a natural thread, and submits the question', async () => {
  const parentSession = {
    provider: 'codex',
    language: 'zh',
    runnerSessionId: 'parent-thread-1',
    workspaceDir: '/repo',
  };
  const sideSession = { provider: 'codex', language: 'zh' };
  const threadCreates = [];
  const threadMessages = [];
  const queuedPrompts = [];
  const sideStarts = [];
  const responses = [];
  const childThread = {
    id: 'side-channel-1',
    async join() {},
    async send(payload) {
      threadMessages.push(payload);
      return { id: 'side-header-1' };
    },
  };
  const parentChannel = {
    id: 'parent-channel-1',
    name: '整理发布流程',
    threads: {
      async create(options) {
        threadCreates.push(options);
        return childThread;
      },
    },
  };

  const surface = createSurface({
    getSession: (key) => (key === childThread.id ? sideSession : parentSession),
    commandActions: {
      bindSideConversation(currentParent, currentSide, binding) {
        currentParent.openSideConversation = { status: 'open', ...binding };
        currentSide.runnerSessionId = binding.sideSessionId;
        currentSide.sideConversation = { status: 'open', ...binding };
        return { parent: currentParent.openSideConversation, side: currentSide.sideConversation };
      },
    },
    ensureWorkspace: () => '/repo',
    resolveSecurityContext: () => ({ profile: 'team' }),
    async startCodexSideConversation(options) {
      sideStarts.push(options);
      return {
        ok: true,
        parentThreadId: 'parent-thread-1',
        sideThreadId: 'side-thread-1',
      };
    },
    async enqueuePrompt(message, key, prompt, securityContext) {
      queuedPrompts.push({ message, key, prompt, securityContext });
      return { ok: true, enqueued: true, queuedAhead: 0 };
    },
  });

  const runningComponents = surface.buildRunningTaskComponents({
    message: { channel: parentChannel },
    session: parentSession,
    language: 'zh',
  });
  assert.equal(runningComponents[0].components[0].data.custom_id, 'cxs:ask:parent-channel-1');
  assert.equal(runningComponents[0].components[0].data.label, '问一下');

  const shownModals = [];
  const askButton = {
    customId: 'cxs:ask:parent-channel-1',
    channelId: parentChannel.id,
    channel: parentChannel,
    async showModal(modal) {
      shownModals.push(modal);
    },
  };
  assert.equal(await surface.handleComponent(askButton, async (payload) => responses.push(payload)), true);
  assert.equal(shownModals[0].data.custom_id, 'cxsm:ask:parent-channel-1');
  assert.equal(shownModals[0].data.title, '问一下');

  const modal = {
    id: 'modal-submit-1',
    customId: 'cxsm:ask:parent-channel-1',
    channelId: parentChannel.id,
    channel: parentChannel,
    user: { id: 'user-1' },
    fields: {
      getTextInputValue: () => '这个模块为什么这样设计？',
    },
    deferred: false,
    replied: false,
    async deferReply(payload) {
      this.deferred = true;
      this.deferPayload = payload;
    },
  };
  assert.equal(await surface.handleModalSubmit(modal, async (payload) => responses.push(payload)), true);

  assert.deepEqual(modal.deferPayload, { flags: 64 });
  assert.equal(threadCreates[0].name, '旁问 · 整理发布流程');
  assert.equal(sideStarts.length, 1);
  assert.match(sideStarts[0].sideDeveloperInstructions, /Never edit files or change external state/);
  assert.equal(threadMessages.length, 1);
  assert.match(threadMessages[0].content, /^<@user-1> 这是 <#parent-channel-1> 的旁问。/);
  assert.deepEqual(
    threadMessages[0].components[0].components.map((component) => component.data.label),
    ['回主任务', '告诉主任务', '关闭旁问'],
  );
  assert.deepEqual(
    threadMessages[0].components[0].components.map((component) => component.data.custom_id),
    [
      'cxs:return:parent-channel-1',
      'cxs:tell:parent-channel-1',
      'cxs:close:parent-channel-1',
    ],
  );
  assert.equal(queuedPrompts.length, 1);
  assert.equal(queuedPrompts[0].key, 'side-channel-1');
  assert.equal(queuedPrompts[0].prompt, '这个模块为什么这样设计？');
  assert.deepEqual(queuedPrompts[0].securityContext, { profile: 'team' });
  assert.equal(queuedPrompts[0].message.channel, childThread);
  assert.equal(parentSession.openSideConversation.sideSessionId, 'side-thread-1');
  assert.equal(sideSession.sideConversation.parentChannelId, 'parent-channel-1');
  assert.match(responses.at(-1).content, /旁问已打开：<#side-channel-1>/);
});

test('side interaction can tell the running main task and close only the side thread', async () => {
  const parentSession = {
    provider: 'codex',
    language: 'zh',
    runnerSessionId: 'parent-thread-1',
    openSideConversation: {
      status: 'open',
      parentSessionId: 'parent-thread-1',
      parentChannelId: 'parent-channel-1',
      sideSessionId: 'side-thread-1',
      sideChannelId: 'side-channel-1',
    },
  };
  const sideSession = {
    provider: 'codex',
    language: 'zh',
    runnerSessionId: 'side-thread-1',
    sideConversation: { ...parentSession.openSideConversation },
  };
  const order = [];
  const steers = [];
  const closes = [];
  const cancels = [];
  const responses = [];
  const sideChannel = {
    id: 'side-channel-1',
    async setLocked(value) {
      order.push(`locked:${value}`);
    },
    async setArchived(value) {
      order.push(`archived:${value}`);
    },
  };
  const surface = createSurface({
    getSession: (key) => (key === 'parent-channel-1' ? parentSession : sideSession),
    commandActions: {
      markSideConversationClosed(currentParent, currentSide, result) {
        currentParent.openSideConversation.status = result.status;
        currentSide.sideConversation.status = result.status;
      },
    },
    async steerProviderTask(input) {
      steers.push(input);
      return { ok: true, steered: true };
    },
    async closeCodexSideConversation(input) {
      closes.push(input);
      return { ok: true, unsubscribed: true };
    },
    cancelChannelWork(key, reason) {
      cancels.push({ key, reason });
      return { cancelledRunning: true };
    },
  });

  const tellModal = {
    customId: 'cxsm:tell:parent-channel-1',
    channelId: sideChannel.id,
    channel: sideChannel,
    fields: { getTextInputValue: () => '先保留现有接口，不要改名称。' },
    deferred: false,
    replied: false,
    async deferReply() {
      this.deferred = true;
    },
  };
  assert.equal(await surface.handleModalSubmit(tellModal, async (payload) => responses.push(payload)), true);
  assert.equal(steers.length, 1);
  assert.equal(steers[0].session, parentSession);
  assert.equal(steers[0].sessionKey, 'parent-channel-1');
  assert.equal(steers[0].prompt, '先保留现有接口，不要改名称。');
  assert.equal(responses.at(-1).content, '已告诉主任务。');

  const closeButton = {
    customId: 'cxs:close:parent-channel-1',
    channelId: sideChannel.id,
    channel: sideChannel,
    deferred: false,
    replied: false,
    async deferReply() {
      this.deferred = true;
      order.push('deferred');
    },
  };
  assert.equal(await surface.handleComponent(closeButton, async (payload) => {
    order.push('responded');
    responses.push(payload);
  }), true);

  assert.deepEqual(order, ['deferred', 'locked:true', 'archived:true', 'responded']);
  assert.deepEqual(cancels, [{ key: 'side-channel-1', reason: 'side_close' }]);
  assert.equal(closes[0].threadId, 'side-thread-1');
  assert.equal(parentSession.openSideConversation.status, 'closed');
  assert.equal(sideSession.sideConversation.status, 'closed');
  assert.equal(responses.at(-1).content, '旁问已关闭。');
});

test('side interaction reuses the open side thread for later questions', async () => {
  const parentSession = {
    provider: 'codex',
    language: 'zh',
    runnerSessionId: 'parent-thread-1',
    openSideConversation: {
      status: 'open',
      parentSessionId: 'parent-thread-1',
      parentChannelId: 'parent-channel-1',
      sideSessionId: 'side-thread-1',
      sideChannelId: 'side-channel-1',
    },
  };
  const sideSession = {
    provider: 'codex',
    language: 'zh',
    runnerSessionId: 'side-thread-1',
    sideConversation: { ...parentSession.openSideConversation },
  };
  const queuedPrompts = [];
  const responses = [];
  let starts = 0;
  let creates = 0;
  const sideChannel = { id: 'side-channel-1' };
  const parentChannel = {
    id: 'parent-channel-1',
    threads: {
      async create() {
        creates += 1;
        return { id: 'unexpected-side' };
      },
    },
  };
  const surface = createSurface({
    getSession: (key) => (key === 'side-channel-1' ? sideSession : parentSession),
    resolveSecurityContext: () => ({ profile: 'team' }),
    async startCodexSideConversation() {
      starts += 1;
      return { ok: true };
    },
    async enqueuePrompt(_message, key, prompt) {
      queuedPrompts.push({ key, prompt });
      return { ok: true, enqueued: true, queuedAhead: 0 };
    },
  });
  const modal = {
    customId: 'cxsm:ask:parent-channel-1',
    channelId: parentChannel.id,
    channel: parentChannel,
    client: {
      channels: {
        cache: new Map([['side-channel-1', sideChannel]]),
      },
    },
    user: { id: 'user-1' },
    fields: { getTextInputValue: () => '再看一下错误处理。' },
    deferred: false,
    replied: false,
    async deferReply() {
      this.deferred = true;
    },
  };

  assert.equal(await surface.handleModalSubmit(modal, async (payload) => responses.push(payload)), true);
  assert.equal(starts, 0);
  assert.equal(creates, 0);
  assert.deepEqual(queuedPrompts, [{ key: 'side-channel-1', prompt: '再看一下错误处理。' }]);
  assert.equal(responses[0].content, '已发到现有旁问：<#side-channel-1>');
});

test('side question modal does not create a thread after the main task finishes', async () => {
  const parentSession = {
    provider: 'codex',
    language: 'zh',
    runnerSessionId: 'parent-thread-1',
  };
  let starts = 0;
  let creates = 0;
  const responses = [];
  const parentChannel = {
    id: 'parent-channel-1',
    threads: {
      async create() {
        creates += 1;
        return { id: 'unexpected-side' };
      },
    },
  };
  const surface = createSurface({
    getSession: () => parentSession,
    getRuntimeSnapshot: () => ({ running: false, queued: 0 }),
    async startCodexSideConversation() {
      starts += 1;
      return { ok: true };
    },
  });
  const modal = {
    customId: 'cxsm:ask:parent-channel-1',
    channelId: parentChannel.id,
    channel: parentChannel,
    user: { id: 'user-1' },
    fields: { getTextInputValue: () => '还在跑吗？' },
    deferred: false,
    replied: false,
    async deferReply() {
      this.deferred = true;
    },
  };

  assert.equal(await surface.handleModalSubmit(modal, async (payload) => responses.push(payload)), true);
  assert.equal(starts, 0);
  assert.equal(creates, 0);
  assert.equal(responses[0].content, '主任务已经结束。');
});

test('side button stays hidden for Codex settings that require the one-shot runner', () => {
  const session = {
    provider: 'codex',
    language: 'zh',
    runnerSessionId: 'parent-thread-1',
    configOverrides: [],
  };
  const message = { channel: { id: 'parent-channel-1' } };
  const profileSurface = createSurface({
    resolveCodexProfileSetting: () => ({ isExplicit: true, value: 'work' }),
  });
  assert.deepEqual(profileSurface.buildRunningTaskComponents({ message, session, language: 'zh' }), []);

  const configSurface = createSurface();
  assert.deepEqual(configSurface.buildRunningTaskComponents({
    message,
    session: { ...session, configOverrides: ['foo="bar"'] },
    language: 'zh',
  }), []);
});
