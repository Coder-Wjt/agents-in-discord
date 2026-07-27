import { createInboundMessageContext } from '../inbound-event.js';
import { buildConversationKey, parseConversationKey } from '../conversation-key.js';
import {
  assertConversationHistory,
  assertConversationHistoryMessage,
  assertConversationSpawn,
  assertSpawnedConversation,
} from '../conversation-spawn.js';
import { splitForLark } from './message-delivery.js';

function normalizeId(value) {
  return String(value || '').trim() || null;
}

function unwrapConversation(conversation) {
  return conversation?.raw || conversation?.conversation?.raw || conversation || null;
}

function getSourceTarget(source) {
  return unwrapConversation(source?.conversation || source?.inboundEvent?.conversation || source);
}

function parseMessageBody(item) {
  const content = String(item?.body?.content || item?.content || '').trim();
  if (!content) return '';
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed?.text === 'string') return parsed.text.trim();
    const lines = [];
    const visit = (value) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (typeof value.text === 'string') lines.push(value.text);
      Object.values(value).forEach(visit);
    };
    visit(parsed);
    return lines.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return content;
  }
}

function normalizeHistoryItem(item, botOpenId = null) {
  const id = normalizeId(item?.message_id || item?.messageId || item?.id);
  if (!id) return null;
  const senderId = normalizeId(item?.sender?.id || item?.sender_id);
  const senderType = String(item?.sender?.sender_type || item?.sender_type || '').trim().toLowerCase();
  const isBot = senderType === 'app' || senderType === 'bot';
  return assertConversationHistoryMessage({
    id,
    text: parseMessageBody(item),
    createdAtMs: Math.max(0, Number(item?.create_time || item?.createdAtMs) || 0),
    actor: {
      id: senderId,
      isBot,
      isCurrentBot: botOpenId ? senderId === botOpenId : null,
    },
    raw: item,
  });
}

function resolveListContainer(target) {
  const threadId = normalizeId(target?.threadId || target?.rootId);
  if (threadId) return { type: 'thread', id: threadId };
  return { type: 'chat', id: normalizeId(target?.chatId) };
}

function formatChatReference(conversationId) {
  const normalized = normalizeId(conversationId);
  if (!normalized) return '';
  try {
    const parsed = parseConversationKey(normalized);
    if (parsed.platformId === 'lark') {
      return parsed.threadId
        ? `Lark chat ${parsed.conversationId} / thread ${parsed.threadId}`
        : `Lark chat ${parsed.conversationId}`;
    }
  } catch {
    // Keep raw chat ids readable.
  }
  return `Lark chat ${normalized}`;
}

export function createLarkConversationSpawn({
  messageDelivery,
  getChannel = () => null,
} = {}) {
  function canSpawn(source) {
    const target = getSourceTarget(source);
    return Boolean(
      normalizeId(target?.chatId)
      && String(target?.chatType || '').trim().toLowerCase() !== 'p2p'
      && typeof messageDelivery?.send === 'function',
    );
  }

  async function spawn(source, { name, reason } = {}) {
    if (!canSpawn(source)) {
      throw new Error('当前飞书会话不支持创建 reply-chain 子会话。');
    }
    const sourceTarget = getSourceTarget(source);
    const chatId = normalizeId(sourceTarget.chatId);
    const tenantId = normalizeId(sourceTarget.tenantId || source?.conversation?.tenantId);
    const chatType = String(sourceTarget.chatType || 'group').trim().toLowerCase() || 'group';
    const markerText = `🧵 ${String(name || reason || 'New child conversation').trim()}`;
    const rootMessage = await messageDelivery.send({
      platformId: 'lark',
      chatId,
      chatType,
      tenantId,
    }, markerText);
    const rootId = normalizeId(rootMessage?.messageId || rootMessage?.id);
    if (!rootId) throw new Error('Lark child conversation root message did not return a message id.');
    const id = buildConversationKey({
      platformId: 'lark',
      tenantId,
      conversationId: chatId,
      threadId: rootId,
    });
    return assertSpawnedConversation({
      id,
      raw: {
        platformId: 'lark',
        id,
        chatId,
        chatType,
        tenantId,
        rootId,
        threadId: rootId,
        rootMessageTarget: rootMessage?.responseTarget || {
          chatId,
          chatType,
          tenantId,
          messageId: rootId,
        },
      },
    });
  }

  async function rename(conversation, { name } = {}) {
    const target = unwrapConversation(conversation);
    const rootTarget = target?.rootMessageTarget || {
      chatId: target?.chatId,
      messageId: target?.rootId || target?.threadId,
    };
    if (!normalizeId(rootTarget?.messageId) || typeof messageDelivery?.edit !== 'function') {
      return { ok: false, renamed: false, skipped: true, error: 'Lark reply-chain root cannot be renamed' };
    }
    try {
      await messageDelivery.edit(rootTarget, `🧵 ${String(name || '').trim()}`);
      return { ok: true, renamed: true };
    } catch (error) {
      return { ok: false, renamed: false, error: String(error?.message || error || 'rename failed') };
    }
  }

  async function remove(conversation) {
    const target = unwrapConversation(conversation);
    const rootId = normalizeId(target?.rootId || target?.threadId);
    const channel = getChannel();
    if (!rootId || typeof channel?.recallMessage !== 'function') {
      return { ok: false, removed: false, deleted: false, skipped: true, error: 'Lark reply-chain root cannot be recalled' };
    }
    try {
      await channel.recallMessage(rootId);
      return { ok: true, removed: true, deleted: true };
    } catch (error) {
      return { ok: false, removed: false, deleted: false, error: String(error?.message || error || 'recall failed') };
    }
  }

  async function archive(source, { conversationId, reason } = {}) {
    let parsed = null;
    try {
      parsed = parseConversationKey(conversationId);
    } catch {
      parsed = null;
    }
    const rootId = normalizeId(parsed?.threadId || conversationId);
    if (!rootId || typeof messageDelivery?.edit !== 'function') {
      return { ok: false, archived: false, locked: false, targetLabel: 'Lark reply chain', error: 'reply-chain root is unavailable' };
    }
    try {
      const label = String(reason || 'closed').trim();
      await messageDelivery.edit({
        platformId: 'lark',
        chatId: normalizeId(parsed?.conversationId || getSourceTarget(source)?.chatId),
        messageId: rootId,
      }, `🔒 ${label}`);
      return { ok: true, archived: true, locked: false, targetLabel: 'Lark reply chain', equivalent: 'root_marker' };
    } catch (error) {
      return { ok: false, archived: false, locked: false, targetLabel: 'Lark reply chain', error: String(error?.message || error || 'archive failed') };
    }
  }

  async function send(conversation, payload) {
    if (typeof messageDelivery?.send !== 'function') {
      throw new Error('Lark message delivery is unavailable.');
    }
    return messageDelivery.send(unwrapConversation(conversation), payload);
  }

  function createPromptMessage(source, conversation) {
    const target = unwrapConversation(conversation);
    const sourceConversation = source?.conversation || source?.inboundEvent?.conversation || {};
    const conversationId = normalizeId(conversation?.id || target?.id || sourceConversation.id);
    if (!conversationId || !target) {
      throw new TypeError('Lark prompt message requires a conversation target.');
    }
    return createInboundMessageContext({
      type: 'message',
      platformId: 'lark',
      id: normalizeId(source?.id) || `lark-prompt-${Date.now()}`,
      actor: source?.actor || source?.inboundEvent?.actor || {
        id: 'system',
        displayName: 'system',
        isBot: false,
      },
      conversation: {
        id: conversationId,
        parentId: normalizeId(sourceConversation?.id),
        tenantId: normalizeId(target?.tenantId || sourceConversation?.tenantId),
        isThread: Boolean(target?.threadId || target?.rootId),
        raw: target,
      },
      rawText: '',
      text: '',
      attachments: [],
      replyToMessageId: null,
      isSystem: false,
      targetsBot: false,
      responseTarget: target,
      raw: target,
    });
  }

  async function listRecentMessages(source, { beforeId, limit = 25 } = {}) {
    const target = getSourceTarget(source);
    const container = resolveListContainer(target);
    const channel = getChannel();
    if (!container.id || !channel) return [];
    let items = [];
    if (typeof channel.listMessages === 'function') {
      items = await channel.listMessages({
        containerIdType: container.type,
        containerId: container.id,
        limit,
      });
    } else if (typeof channel?.rawClient?.im?.v1?.message?.list === 'function') {
      const response = await channel.rawClient.im.v1.message.list({
        params: {
          container_id_type: container.type,
          container_id: container.id,
          page_size: Math.max(1, Math.min(50, Number(limit) || 25)),
          sort_type: 'ByCreateTimeDesc',
        },
      });
      items = response?.data?.items || [];
    }
    const normalized = items
      .map((item) => normalizeHistoryItem(item, normalizeId(channel?.botIdentity?.openId)))
      .filter(Boolean);
    const normalizedBeforeId = normalizeId(beforeId);
    const beforeIndex = normalizedBeforeId
      ? normalized.findIndex((message) => message.id === normalizedBeforeId)
      : -1;
    const recent = beforeIndex >= 0 ? normalized.slice(beforeIndex + 1) : normalized;
    return assertConversationHistory(recent.slice(0, Math.max(1, Number(limit) || 25)));
  }

  function formatUserMention(userId) {
    const id = normalizeId(userId);
    return id ? `<at user_id="${id}">${id}</at>` : '';
  }

  return assertConversationSpawn({
    canSpawn,
    spawn,
    rename,
    remove,
    archive,
    send,
    listRecentMessages,
    splitText: splitForLark,
    createPromptMessage,
    formatUserMention,
    formatConversationReference: formatChatReference,
  });
}
