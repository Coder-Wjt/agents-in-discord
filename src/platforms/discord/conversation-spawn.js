import { splitForDiscord } from '../../discord-message-splitter.js';
import {
  assertConversationHistory,
  assertConversationHistoryMessage,
  assertConversationSpawn,
  assertSpawnedConversation,
} from '../conversation-spawn.js';
import { createInboundMessageContext } from '../inbound-event.js';

function normalizeId(value) {
  return String(value || '').trim() || null;
}

function getSourceChannel(source) {
  return source?.conversation?.raw || null;
}

function getSourceActor(source) {
  return source?.actor?.raw || {};
}

function getSourceClient(source) {
  const channel = getSourceChannel(source);
  return channel?.client || source?.responseTarget?.client || null;
}

function resolveThreadCreateChannel(channel) {
  if (channel?.threads && typeof channel.threads.create === 'function') return channel;
  if (
    typeof channel?.isThread === 'function'
    && channel.isThread()
    && channel.parent?.threads
    && typeof channel.parent.threads.create === 'function'
  ) {
    return channel.parent;
  }
  if (channel?.parent?.threads && typeof channel.parent.threads.create === 'function') {
    return channel.parent;
  }
  return null;
}

function resolveRawConversation(conversation) {
  return conversation?.raw || conversation || null;
}

function collectionToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  if (typeof value[Symbol.iterator] === 'function') {
    return [...value].map((entry) => (
      Array.isArray(entry) && entry.length >= 2 ? entry[1] : entry
    ));
  }
  return [];
}

function normalizeRecentMessage(message, currentBotUserId) {
  const authorId = normalizeId(message?.author?.id);
  const actor = {
    id: authorId,
    isBot: Boolean(message?.author?.bot),
    isCurrentBot: currentBotUserId ? authorId === currentBotUserId : null,
  };
  return assertConversationHistoryMessage({
    id: normalizeId(message?.id),
    text: String(message?.content || '').trim(),
    createdAtMs: Number(message?.createdTimestamp || 0),
    actor,
    raw: message,
  });
}

function normalizePromptActor(source) {
  const raw = getSourceActor(source);
  return {
    id: normalizeId(source?.actor?.id || raw?.id) || '',
    displayName: String(
      source?.actor?.displayName
      || raw?.tag
      || raw?.globalName
      || raw?.username
      || raw?.id
      || '',
    ).trim(),
    isBot: Boolean(source?.actor?.isBot ?? raw?.bot),
    raw: source?.actor?.raw || raw || null,
  };
}

function normalizePromptConversation(source, resolvedConversation, target) {
  const sourceConversation = source?.conversation || null;
  const sourceConversationId = normalizeId(sourceConversation?.id);
  const isDifferentConversation = Boolean(
    sourceConversationId
    && sourceConversationId !== resolvedConversation.id,
  );
  const isThread = typeof target?.isThread === 'function'
    ? Boolean(target.isThread())
    : isDifferentConversation || Boolean(sourceConversation?.isThread);
  return {
    id: resolvedConversation.id,
    tenantId: normalizeId(
      sourceConversation?.tenantId
      || target?.guild?.id
      || target?.parent?.guild?.id,
    ),
    parentId: isThread
      ? normalizeId(
        target?.parentId
        || (isDifferentConversation ? sourceConversationId : sourceConversation?.parentId),
      )
      : null,
    isThread,
    raw: target,
  };
}

async function resolveConversation(source, conversationId) {
  const normalizedConversationId = normalizeId(conversationId);
  if (!normalizedConversationId) return null;
  const channel = getSourceChannel(source);
  const client = getSourceClient(source);
  if (normalizeId(channel?.id) === normalizedConversationId) return channel;
  const cached = client?.channels?.cache?.get?.(normalizedConversationId);
  if (cached) return cached;
  const fetcher = client?.channels?.fetch;
  if (typeof fetcher !== 'function') return null;
  return fetcher.call(client.channels, normalizedConversationId);
}

export function createDiscordConversationSpawn({
  splitText = splitForDiscord,
  autoArchiveDuration = 1440,
} = {}) {
  async function spawn(source, { name, reason } = {}) {
    const targetChannel = resolveThreadCreateChannel(getSourceChannel(source));
    if (!targetChannel) {
      throw new Error('当前频道不支持创建 Discord thread。');
    }
    const thread = await targetChannel.threads.create({
      name: String(name || '').trim(),
      autoArchiveDuration,
      reason: String(reason || '').trim() || undefined,
    });
    try {
      await thread.join?.();
    } catch {
      // Joining a newly created thread is best-effort.
    }
    return assertSpawnedConversation({
      id: String(thread.id),
      raw: thread,
    });
  }

  async function rename(conversation, { name, reason } = {}) {
    const target = resolveRawConversation(conversation);
    if (typeof target?.setName !== 'function') {
      return { ok: false, renamed: false, skipped: true, error: 'Discord thread cannot be renamed' };
    }
    try {
      await target.setName(String(name || '').trim(), String(reason || '').trim() || undefined);
      return { ok: true, renamed: true };
    } catch (error) {
      return {
        ok: false,
        renamed: false,
        error: String(error?.message || error || 'rename failed'),
      };
    }
  }

  async function remove(conversation, { reason } = {}) {
    const target = resolveRawConversation(conversation);
    if (typeof target?.delete !== 'function') {
      return {
        ok: false,
        removed: false,
        deleted: false,
        skipped: true,
        error: 'Discord thread cannot be deleted',
      };
    }
    try {
      await target.delete(String(reason || '').trim() || undefined);
      return { ok: true, removed: true, deleted: true };
    } catch (error) {
      return {
        ok: false,
        removed: false,
        deleted: false,
        error: String(error?.message || error || 'delete failed'),
      };
    }
  }

  async function archive(source, { conversationId, reason } = {}) {
    const thread = await resolveConversation(source, conversationId);
    if (!thread) {
      return {
        ok: false,
        archived: false,
        locked: false,
        targetLabel: 'Discord thread',
        error: 'side Discord thread not found',
      };
    }
    const normalizedReason = String(reason || '').trim() || undefined;
    const result = {
      ok: true,
      archived: false,
      locked: false,
      targetLabel: 'Discord thread',
      error: '',
    };
    try {
      if (typeof thread.setLocked === 'function') {
        await thread.setLocked(true, normalizedReason);
        result.locked = true;
      }
    } catch (error) {
      result.ok = false;
      result.error = String(error?.message || error || 'lock failed');
    }
    try {
      if (typeof thread.setArchived === 'function') {
        await thread.setArchived(true, normalizedReason);
        result.archived = true;
      }
    } catch (error) {
      result.ok = false;
      const message = String(error?.message || error || 'archive failed');
      result.error = result.error ? `${result.error}; ${message}` : message;
    }
    if (typeof thread.setArchived !== 'function') {
      result.ok = false;
      result.error = result.error || 'side Discord thread cannot be archived';
    }
    return result;
  }

  async function send(conversation, { content, mentionUserIds = [] } = {}) {
    const target = resolveRawConversation(conversation);
    if (typeof target?.send !== 'function') {
      throw new Error('Discord thread cannot send messages');
    }
    const payload = { content: String(content || '') };
    const users = [...new Set(mentionUserIds.map(normalizeId).filter(Boolean))];
    if (users.length) payload.allowedMentions = { users };
    return target.send(payload);
  }

  async function listRecentMessages(source, { beforeId, limit = 25 } = {}) {
    const channel = getSourceChannel(source);
    const fetch = channel?.messages?.fetch;
    if (typeof fetch !== 'function') return [];
    const options = { limit: Math.max(1, Number(limit) || 25) };
    const normalizedBeforeId = normalizeId(beforeId);
    if (normalizedBeforeId) options.before = normalizedBeforeId;
    const currentBotUserId = normalizeId(getSourceClient(source)?.user?.id);
    return assertConversationHistory(
      collectionToArray(await fetch.call(channel.messages, options))
        .map((message) => normalizeRecentMessage(message, currentBotUserId)),
    );
  }

  function createPromptMessage(source, conversation, { reply = null } = {}) {
    const target = resolveRawConversation(conversation);
    const resolvedConversation = assertSpawnedConversation({
      id: String(conversation?.id || target?.id || ''),
      raw: target,
    });
    const actor = normalizePromptActor(source);
    const normalizedConversation = normalizePromptConversation(source, resolvedConversation, target);
    const client = getSourceClient(source) || target?.client || null;
    const reactions = {
      cache: {
        get: () => ({ users: { remove: async () => {} } }),
      },
    };
    const responseTarget = {
      channel: target,
      client,
      reactions,
      react: async () => {},
      reply: async (payload) => (
        typeof reply === 'function'
          ? reply(source, payload)
          : target.send(payload)
      ),
    };
    return createInboundMessageContext({
      type: 'message',
      platformId: 'discord',
      id: String(source?.id || `fork-${Date.now()}`),
      actor,
      conversation: normalizedConversation,
      rawText: '',
      text: '',
      attachments: [],
      replyToMessageId: null,
      isSystem: false,
      targetsBot: false,
      responseTarget,
      raw: responseTarget,
    });
  }

  function formatUserMention(userId) {
    const normalized = normalizeId(userId);
    return normalized ? `<@${normalized}>` : '';
  }

  function formatConversationReference(conversationId) {
    const normalized = normalizeId(conversationId);
    return normalized ? `<#${normalized}>` : '';
  }

  return assertConversationSpawn({
    canSpawn: (source) => Boolean(resolveThreadCreateChannel(getSourceChannel(source))),
    spawn,
    rename,
    remove,
    archive,
    send,
    listRecentMessages,
    splitText,
    createPromptMessage,
    formatUserMention,
    formatConversationReference,
  });
}
