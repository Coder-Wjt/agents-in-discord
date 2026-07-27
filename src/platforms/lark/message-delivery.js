import { parseConversationKey } from '../conversation-key.js';
import { assertCommandViewRenderer } from '../command-view.js';
import { assertMessageDelivery, MESSAGE_STATUSES } from '../message-delivery.js';
import { createLarkCommandViewRenderer } from './command-view-renderer.js';
import {
  embedLarkPrivateConversationContext,
  normalizeLarkPrivateConversationContext,
} from './private-context.js';

const STATUS_REACTION = Object.freeze({
  processing: 'THINKING',
  succeeded: 'THUMBSUP',
  cancelled: 'No',
  failed: 'SOB',
  dequeued: 'No',
});
const MESSAGE_TARGET_CACHE_LIMIT = 2000;

function normalizeText(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.content || value.text || '');
  }
  return String(value || '');
}

function normalizePayload(value, renderer) {
  if (value?.type === 'message') return renderer.renderMessage(value);
  if (value?.type === 'modal') return renderer.renderModal(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.card && typeof value.card === 'object') return value;
    if ('content' in value || 'rows' in value || 'visibility' in value) {
      return renderer.renderMessage({ type: 'message', ...value });
    }
    return {
      ...value,
      text: normalizeText(value),
    };
  }
  return { text: normalizeText(value) };
}

function escapeAtLabel(value) {
  return String(value || '').replace(/[<>&"]/g, '');
}

export function splitForLark(text, maxChars = 4000) {
  const value = String(text || '');
  const limit = Math.max(200, Number(maxChars) || 4000);
  if (!value) return [''];
  if (value.length <= limit) return [value];
  const chunks = [];
  let remaining = value;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt < Math.floor(limit * 0.5)) splitAt = remaining.lastIndexOf(' ', limit);
    if (splitAt < Math.floor(limit * 0.5)) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function unwrapTarget(target) {
  if (!target) return null;
  if (target.responseTarget) return target.responseTarget;
  if (target.inboundEvent?.responseTarget) return target.inboundEvent.responseTarget;
  if (target.conversation?.raw) return target.conversation.raw;
  if (target.platformId === 'lark' && target.chatId) return target;
  if (target.raw?.chatId) return target.raw;
  return target;
}

function resolveConversationTarget(value) {
  const target = unwrapTarget(value);
  if (typeof target === 'string') {
    try {
      const parsed = parseConversationKey(target);
      if (parsed.platformId === 'lark') {
        return {
          platformId: 'lark',
          id: target,
          chatId: parsed.conversationId,
          tenantId: parsed.tenantId,
          threadId: parsed.threadId,
        };
      }
    } catch {
      return { platformId: 'lark', chatId: target };
    }
  }
  return target;
}

export function createLarkMessageDelivery({
  getChannel = () => null,
  commandViewRenderer = createLarkCommandViewRenderer(),
  textChunkLimit = 4000,
  now = Date.now,
} = {}) {
  const renderer = assertCommandViewRenderer(commandViewRenderer);
  const resolvedTextChunkLimit = Math.max(200, Number(textChunkLimit) || 4000);
  const messageTargets = new Map();
  const metrics = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    inFlight: 0,
    byOperation: {},
    lastSuccessAt: null,
    lastFailure: null,
  };

  function getOperationMetrics(operation) {
    if (!metrics.byOperation[operation]) {
      metrics.byOperation[operation] = { attempted: 0, succeeded: 0, failed: 0 };
    }
    return metrics.byOperation[operation];
  }

  async function trackDelivery(operation, action) {
    const operationMetrics = getOperationMetrics(operation);
    metrics.attempted += 1;
    metrics.inFlight += 1;
    operationMetrics.attempted += 1;
    try {
      const result = await action();
      metrics.succeeded += 1;
      operationMetrics.succeeded += 1;
      metrics.lastSuccessAt = Number(now()) || Date.now();
      return result;
    } catch (error) {
      metrics.failed += 1;
      operationMetrics.failed += 1;
      metrics.lastFailure = {
        operation,
        at: Number(now()) || Date.now(),
        error: String(error?.message || error || 'unknown error'),
      };
      throw error;
    } finally {
      metrics.inFlight -= 1;
    }
  }

  function getMetricsSnapshot() {
    return {
      available: true,
      attempted: metrics.attempted,
      succeeded: metrics.succeeded,
      failed: metrics.failed,
      inFlight: metrics.inFlight,
      byOperation: Object.fromEntries(
        Object.entries(metrics.byOperation).map(([operation, value]) => [operation, { ...value }]),
      ),
      lastSuccessAt: metrics.lastSuccessAt,
      lastFailure: metrics.lastFailure ? { ...metrics.lastFailure } : null,
    };
  }

  function rememberMessageTarget(messageId, target) {
    const id = String(messageId || '').trim();
    if (!id || !target) return;
    messageTargets.delete(id);
    messageTargets.set(id, { ...target });
    while (messageTargets.size > MESSAGE_TARGET_CACHE_LIMIT) {
      messageTargets.delete(messageTargets.keys().next().value);
    }
  }

  function resolveMessageTarget(messageId) {
    const target = messageTargets.get(String(messageId || '').trim());
    return target ? { ...target } : null;
  }

  async function deliver(target, payload, { reply = false } = {}) {
    return trackDelivery(reply ? 'reply' : 'send', async () => {
      const resolved = resolveConversationTarget(target);
      const chatId = String(resolved?.chatId || '').trim();
      const userId = String(resolved?.userId || '').trim();
      const receiveId = chatId || userId;
      if (!receiveId) throw new TypeError('Lark message target requires chatId or userId.');
      const channel = getChannel();
      if (typeof channel?.send !== 'function') throw new Error('Lark channel is not connected.');
      const options = {};
      if (reply && resolved?.messageId) options.replyTo = String(resolved.messageId);
      if (!reply && (resolved?.threadId || resolved?.rootId)) {
        options.replyTo = String(resolved.rootId || resolved.threadId);
      }
      if (resolved?.threadId || resolved?.rootId) options.replyInThread = true;
      const rendered = normalizePayload(payload, renderer);
      const contextConversation = normalizeLarkPrivateConversationContext(resolved?.contextConversation);
      const card = rendered.interactive && contextConversation
        ? embedLarkPrivateConversationContext(rendered.card, contextConversation)
        : rendered.card;
      const sendInput = rendered.interactive ? { card } : { text: rendered.text };
      const result = await channel.send(receiveId, sendInput, options);
      const messageId = String(result?.messageId || result?.message_id || '').trim();
      const resolvedChatId = String(result?.chatId || result?.chat_id || chatId).trim();
      if (!resolvedChatId) {
        throw new Error('Lark direct-message send did not resolve a chatId.');
      }
      const responseTarget = {
        ...resolved,
        chatId: resolvedChatId,
        chatType: resolved?.chatType || (userId ? 'p2p' : undefined),
        messageId,
        isCard: Boolean(rendered.interactive),
        ...(contextConversation ? { contextConversation } : {}),
      };
      rememberMessageTarget(messageId, responseTarget);
      return {
        id: messageId,
        messageId,
        chatId: resolvedChatId,
        responseTarget,
        raw: result,
      };
    });
  }

  async function edit(target, payload) {
    return trackDelivery('edit', async () => {
      const resolved = resolveConversationTarget(target);
      const messageId = String(resolved?.messageId || resolved?.id || '').trim();
      if (!messageId) throw new TypeError('Lark edit target requires messageId.');
      const channel = getChannel();
      const rendered = normalizePayload(payload, renderer);
      const contextConversation = normalizeLarkPrivateConversationContext(resolved?.contextConversation);
      if (resolved?.isCard || rendered.interactive) {
        if (typeof channel?.updateCard !== 'function') throw new Error('Lark card editing is unavailable.');
        const baseCard = rendered.card || renderer.renderMessage({ content: rendered.text || '' }).card;
        const card = contextConversation
          ? embedLarkPrivateConversationContext(baseCard, contextConversation)
          : baseCard;
        await channel.updateCard(messageId, card);
        return target;
      }
      if (typeof channel?.editMessage !== 'function') throw new Error('Lark message editing is unavailable.');
      await channel.editMessage(messageId, rendered.text);
      return target;
    });
  }

  function startTyping() {
    return () => {};
  }

  function formatUserMention(userId) {
    const id = String(userId || '').trim();
    return id ? `<at user_id="${escapeAtLabel(id)}">${escapeAtLabel(id)}</at>` : '';
  }

  async function setMessageStatus(message, status) {
    if (!MESSAGE_STATUSES.includes(status)) {
      throw new TypeError(`Unsupported message status: ${status}`);
    }
    const resolved = resolveConversationTarget(message);
    const messageId = String(resolved?.messageId || resolved?.id || '').trim();
    if (!messageId) return message;
    return trackDelivery('reaction', async () => {
      const channel = getChannel();
      if (status !== 'processing' && typeof channel?.removeReactionByEmoji === 'function') {
        await channel.removeReactionByEmoji(messageId, STATUS_REACTION.processing).catch(() => false);
      }
      const emojiType = STATUS_REACTION[status];
      if (emojiType && typeof channel?.addReaction === 'function') {
        await channel.addReaction(messageId, emojiType);
      }
      return message;
    });
  }

  return assertMessageDelivery({
    reply: (target, payload) => deliver(target, payload, { reply: true }),
    send: (target, payload) => deliver(target, payload),
    edit,
    startTyping,
    splitText: (text, maxChars = resolvedTextChunkLimit) => splitForLark(text, maxChars),
    formatUserMention,
    setMessageStatus,
    getMetricsSnapshot,
    resolveMessageTarget,
  });
}
