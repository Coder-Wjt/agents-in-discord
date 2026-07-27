import test from 'node:test';
import assert from 'node:assert/strict';

import { parseConversationKey } from '../src/platforms/conversation-key.js';
import { createLarkConversationSpawn } from '../src/platforms/lark/conversation-spawn.js';
import { createLarkConversationPresentation } from '../src/platforms/lark/conversation-presentation.js';
import { createProviderForkThread } from '../src/codex-fork-flow.js';
import {
  closeCodexSideConversationFlow,
  createCodexSideConversation,
} from '../src/codex-side-flow.js';

function createSource() {
  const raw = {
    platformId: 'lark',
    chatId: 'oc_group',
    chatType: 'group',
    tenantId: 'tenant_1',
    messageId: 'om_source',
  };
  return {
    id: 'om_source',
    actor: { id: 'ou_user', displayName: 'User One', isBot: false },
    conversation: {
      id: 'platform:v1:lark:tenant_1:oc_group:',
      tenantId: 'tenant_1',
      isThread: false,
      raw,
    },
    responseTarget: raw,
  };
}

test('Lark conversation spawn maps child conversations to new reply-chain roots', async () => {
  const calls = [];
  const delivery = {
    async send(target, payload) {
      calls.push({ kind: 'send', target, payload });
      if (!target.rootId && !target.threadId) {
        return {
          messageId: 'om_root',
          responseTarget: { ...target, messageId: 'om_root' },
        };
      }
      return { messageId: 'om_child_message', responseTarget: target };
    },
    async edit(target, payload) {
      calls.push({ kind: 'edit', target, payload });
      return target;
    },
  };
  const recalled = [];
  const spawn = createLarkConversationSpawn({
    messageDelivery: delivery,
    getChannel: () => ({
      async recallMessage(messageId) { recalled.push(messageId); },
    }),
  });
  const source = createSource();

  assert.equal(spawn.canSpawn(source), true);
  const child = await spawn.spawn(source, { name: 'Codex fork demo' });
  assert.deepEqual(parseConversationKey(child.id), {
    platformId: 'lark',
    tenantId: 'tenant_1',
    conversationId: 'oc_group',
    threadId: 'om_root',
  });
  assert.equal(child.raw.rootId, 'om_root');
  assert.equal(child.raw.threadId, 'om_root');
  assert.equal(child.raw.rootMessageTarget.isCard, true);
  assert.deepEqual(calls[0], {
    kind: 'send',
    target: {
      platformId: 'lark',
      chatId: 'oc_group',
      chatType: 'group',
      tenantId: 'tenant_1',
    },
    payload: {
      content: '🧵 Codex fork demo',
      interactive: true,
    },
  });

  await spawn.send(child, { content: 'child ready' });
  assert.equal(calls[1].target.rootId, 'om_root');
  await spawn.rename(child, { name: 'Renamed reply chain' });
  assert.deepEqual(calls[2], {
    kind: 'edit',
    target: {
      platformId: 'lark',
      chatId: 'oc_group',
      chatType: 'group',
      tenantId: 'tenant_1',
      messageId: 'om_root',
      isCard: true,
    },
    payload: '🧵 Renamed reply chain',
  });

  const prompt = spawn.createPromptMessage(source, child);
  assert.equal(prompt.actor.id, 'ou_user');
  assert.equal(prompt.conversation.id, child.id);
  assert.equal(prompt.conversation.parentId, source.conversation.id);
  assert.equal(prompt.conversation.isThread, true);

  assert.deepEqual(await spawn.archive(source, {
    conversationId: child.id,
    reason: 'Codex side conversation closed',
  }), {
    ok: true,
    archived: true,
    locked: false,
    targetLabel: 'Lark reply chain',
    equivalent: 'root_marker',
  });
  assert.deepEqual(calls[3], {
    kind: 'edit',
    target: {
      platformId: 'lark',
      chatId: 'oc_group',
      messageId: 'om_root',
      isCard: true,
    },
    payload: '🔒 Codex side conversation closed',
  });
  assert.deepEqual(await spawn.remove(child), {
    ok: true,
    removed: true,
    deleted: true,
  });
  assert.deepEqual(recalled, ['om_root']);
});

test('Lark conversation spawn rejects direct chats and normalizes recent history', async () => {
  const source = createSource();
  source.conversation.raw.rootId = 'om_parent_root';
  source.conversation.raw.threadId = 'omt_parent';
  const listCalls = [];
  const spawn = createLarkConversationSpawn({
    messageDelivery: { async send() {}, async edit() {} },
    getChannel: () => ({
      botIdentity: { openId: 'ou_bot' },
      async listMessages(options) {
        listCalls.push(options);
        return [
          {
            message_id: 'om_source',
            msg_type: 'text',
            body: { content: JSON.stringify({ text: 'fork now' }) },
            sender: { id: 'ou_user', sender_type: 'user' },
            create_time: '3000',
          },
          {
            message_id: 'om_agent',
            msg_type: 'text',
            body: { content: JSON.stringify({ text: 'latest answer' }) },
            sender: { id: 'ou_bot', sender_type: 'app' },
            create_time: '2000',
          },
        ];
      },
    }),
  });

  const history = await spawn.listRecentMessages(source, { beforeId: 'om_source', limit: 25 });
  assert.deepEqual(listCalls, [{ containerIdType: 'thread', containerId: 'omt_parent', limit: 25 }]);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, 'om_agent');
  assert.equal(history[0].text, 'latest answer');
  assert.equal(history[0].actor.isCurrentBot, true);

  source.conversation.raw.chatType = 'p2p';
  assert.equal(spawn.canSpawn(source), false);
});

test('Lark reply-chain spawn runs the shared provider fork flow', async () => {
  let nextMessage = 1;
  const delivery = {
    async send(target) {
      const messageId = nextMessage === 1 ? 'om_fork_root' : `om_sent_${nextMessage}`;
      nextMessage += 1;
      return { messageId, responseTarget: { ...target, messageId } };
    },
    async edit(target) { return target; },
  };
  const conversationSpawn = createLarkConversationSpawn({
    messageDelivery: delivery,
    getChannel: () => ({
      botIdentity: { openId: 'ou_bot' },
      async listMessages() { return []; },
      async recallMessage() {},
    }),
  });
  const childSessions = new Map();
  const enqueues = [];

  const result = await createProviderForkThread({
    key: 'platform:v1:lark:tenant_1:oc_group:',
    session: { provider: 'codex', language: 'zh' },
    source: createSource(),
    parentSessionId: 'codex-parent',
    threadName: 'Lark fork',
    prompt: 'continue in child',
    provider: 'codex',
    getRuntimeSnapshot: () => ({ running: false, queued: 0 }),
    getSession: (key, defaults) => {
      const session = { ...defaults, provider: 'codex', language: 'zh' };
      childSessions.set(key, session);
      return session;
    },
    commandActions: {
      bindForkedSession(childSession, binding) {
        Object.assign(childSession, binding);
        return binding;
      },
    },
    forkCodexThread: async () => ({ threadId: 'codex-child', forkedFromId: 'codex-parent' }),
    enqueuePrompt: async (message, key, prompt) => {
      enqueues.push({ message, key, prompt });
      return { enqueued: true };
    },
    resolveSecurityContext: () => ({ profile: 'team' }),
    conversationSpawn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.forkedSessionId, 'codex-child');
  assert.equal(parseConversationKey(result.childConversation.id).threadId, 'om_fork_root');
  assert.equal(childSessions.get(result.childConversation.id).parentChannelId, 'platform:v1:lark:tenant_1:oc_group:');
  assert.equal(enqueues.length, 1);
  assert.equal(enqueues[0].key, result.childConversation.id);
  assert.equal(enqueues[0].message.conversation.isThread, true);
  assert.equal(enqueues[0].prompt, 'continue in child');
});

test('Lark reply-chain spawn runs the shared Codex side lifecycle', async () => {
  let nextMessage = 1;
  const deliveryCalls = [];
  const delivery = {
    async send(target, payload) {
      const messageId = nextMessage === 1 ? 'om_side_root' : `om_side_${nextMessage}`;
      nextMessage += 1;
      deliveryCalls.push({ kind: 'send', target, payload, messageId });
      return { messageId, responseTarget: { ...target, messageId } };
    },
    async edit(target, payload) {
      deliveryCalls.push({ kind: 'edit', target, payload });
      return target;
    },
  };
  const conversationSpawn = createLarkConversationSpawn({
    messageDelivery: delivery,
    getChannel: () => ({
      async recallMessage() {},
    }),
  });
  const parentKey = 'platform:v1:lark:tenant_1:oc_group:';
  const parentSession = {
    provider: 'codex',
    language: 'zh',
    runnerSessionId: 'codex-parent',
    workspaceDir: '/repo',
  };
  const sessions = new Map([[parentKey, parentSession]]);
  const getSession = (key, defaults = {}) => {
    if (!sessions.has(key)) sessions.set(key, { ...defaults, provider: 'codex', language: 'zh' });
    return sessions.get(key);
  };
  const commandActions = {
    bindSideConversation(currentParent, currentSide, binding) {
      currentParent.openSideConversation = { status: 'open', ...binding };
      currentSide.runnerSessionId = binding.sideSessionId;
      currentSide.sideConversation = { status: 'open', ...binding };
      return {
        parent: currentParent.openSideConversation,
        side: currentSide.sideConversation,
      };
    },
    markSideConversationClosed(currentParent, currentSide, { status, cleanupError }) {
      currentParent.openSideConversation.status = status;
      currentParent.openSideConversation.cleanupError = cleanupError;
      currentSide.sideConversation.status = status;
      currentSide.sideConversation.cleanupError = cleanupError;
    },
  };

  const opened = await createCodexSideConversation({
    key: parentKey,
    session: parentSession,
    source: createSource(),
    parentSessionId: 'codex-parent',
    threadName: 'Lark side notes',
    getRuntimeSnapshot: () => ({ running: true }),
    getSession,
    commandActions,
    startCodexSideConversation: async () => ({
      ok: true,
      parentThreadId: 'codex-parent',
      sideThreadId: 'codex-side',
    }),
    ensureWorkspace: () => '/repo',
    getSessionLanguage: () => 'zh',
    conversationSpawn,
    conversationPresentation: createLarkConversationPresentation(),
    generateSideSeed: () => 'planned-side',
  });

  assert.equal(opened.ok, true);
  assert.equal(parseConversationKey(opened.childConversation.id).threadId, 'om_side_root');
  assert.equal(parentSession.openSideConversation.sideSessionId, 'codex-side');
  assert.equal(parentSession.openSideConversation.sideChannelId, opened.childConversation.id);
  const sideSession = getSession(opened.childConversation.id);
  assert.equal(sideSession.runnerSessionId, 'codex-side');
  assert.equal(sideSession.sideConversation.parentChannelId, parentKey);
  assert.deepEqual(deliveryCalls[0].payload, {
    content: '🧵 Lark side notes',
    interactive: true,
  });
  assert.equal(deliveryCalls[1].target.rootId, 'om_side_root');
  assert.match(deliveryCalls[1].payload.content, /<at user_id="ou_user">ou_user<\/at>/);
  assert.match(deliveryCalls[1].payload.content, /已从父飞书会话/);

  const closed = await closeCodexSideConversationFlow({
    key: parentKey,
    session: parentSession,
    getSession,
    commandActions,
    closeCodexSideConversation: async ({ threadId }) => ({
      ok: true,
      unsubscribed: true,
      threadId,
    }),
    cancelChannelWork: (key, reason) => ({ key, reason }),
    source: createSource(),
    conversationSpawn,
  });

  assert.equal(closed.ok, true);
  assert.equal(closed.sideSessionId, 'codex-side');
  assert.equal(parentSession.openSideConversation.status, 'closed');
  assert.equal(sideSession.sideConversation.status, 'closed');
  assert.deepEqual(closed.cancelOutcome, {
    key: opened.childConversation.id,
    reason: 'side_close',
  });
  assert.equal(closed.conversationArchive.equivalent, 'root_marker');
  assert.deepEqual(deliveryCalls.at(-1), {
    kind: 'edit',
    target: {
      platformId: 'lark',
      chatId: 'oc_group',
      messageId: 'om_side_root',
      isCard: true,
    },
    payload: '🔒 Codex side conversation closed',
  });
});
