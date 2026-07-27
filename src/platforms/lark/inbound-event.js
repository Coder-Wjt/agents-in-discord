import { buildConversationKey } from '../conversation-key.js';
import {
  assertInboundInteractionEvent,
  assertInboundMessageEvent,
  assertInboundEventNormalizer,
} from '../inbound-event.js';
import { resolveLarkModalSubmission } from './card-interactions.js';
import {
  extractLarkPrivateConversationContext,
  normalizeLarkPrivateConversationContext,
} from './private-context.js';

function normalizeId(value) {
  return String(value || '').trim() || null;
}

function resolveTenantId(message) {
  const raw = message?.raw?.event || message?.raw || {};
  return normalizeId(
    message?.tenantId
    || raw?.tenant_key
    || raw?.tenantKey
    || raw?.sender?.tenant_key
    || raw?.sender?.tenantKey
    || raw?.header?.tenant_key,
  );
}

function buildLarkConversationKey({ tenantId, chatId, threadId = null }) {
  return buildConversationKey({
    platformId: 'lark',
    tenantId,
    conversationId: chatId,
    threadId,
  });
}

function resourceMimeType(resource) {
  const name = String(resource?.fileName || '').trim().toLowerCase();
  if (resource?.type === 'image') {
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.webp')) return 'image/webp';
    return 'image/*';
  }
  if (resource?.type === 'audio') return 'audio/*';
  if (resource?.type === 'video') return 'video/*';
  return 'application/octet-stream';
}

function normalizeAttachments(resources, { getChannel } = {}) {
  if (!Array.isArray(resources)) return [];
  return resources.map((resource, index) => {
    const fileKey = normalizeId(resource?.fileKey) || `resource-${index + 1}`;
    const type = String(resource?.type || 'file').trim().toLowerCase() || 'file';
    const name = String(resource?.fileName || `${type}-${fileKey}`).trim();
    const downloadType = type === 'image' ? 'image' : 'file';
    const download = async () => {
      const channel = getChannel?.();
      if (typeof channel?.downloadResource !== 'function') {
        throw new Error('Lark resource downloader is unavailable');
      }
      return channel.downloadResource(fileKey, downloadType);
    };
    return {
      id: fileKey,
      name,
      mimeType: resourceMimeType(resource),
      sizeBytes: Number.isFinite(resource?.sizeBytes) ? resource.sizeBytes : null,
      url: String(resource?.url || `lark-resource://${downloadType}/${encodeURIComponent(fileKey)}`),
      raw: {
        ...resource,
        fileKey,
        type: downloadType,
        download,
      },
      download,
    };
  });
}

function resolveThreadId(message) {
  return normalizeId(message?.rootId || message?.threadId);
}

function isBotActor(message, channel) {
  const raw = message?.raw?.event || message?.raw || {};
  const senderType = String(
    raw?.sender?.sender_type
    || raw?.senderType
    || raw?.sender_type
    || '',
  ).trim().toLowerCase();
  const botOpenId = normalizeId(channel?.botIdentity?.openId);
  const senderId = normalizeId(message?.senderId);
  return senderType === 'app' || Boolean(botOpenId && senderId === botOpenId);
}

export function createLarkInboundEventNormalizer({
  getChannel = () => null,
  resolveMessageTarget = () => null,
} = {}) {
  function normalizeMessage(message) {
    const chatId = normalizeId(message?.chatId);
    const messageId = normalizeId(message?.messageId);
    const actorId = normalizeId(message?.senderId);
    if (!chatId || !messageId || !actorId) {
      throw new TypeError('Lark message requires chatId, messageId, and senderId.');
    }
    const tenantId = resolveTenantId(message);
    const threadId = resolveThreadId(message);
    const conversationId = buildLarkConversationKey({ tenantId, chatId, threadId });
    const parentId = threadId
      ? buildLarkConversationKey({ tenantId, chatId })
      : null;
    const responseTarget = {
      platformId: 'lark',
      id: conversationId,
      chatId,
      chatType: message?.chatType || 'group',
      tenantId,
      messageId,
      rootId: normalizeId(message?.rootId),
      threadId: normalizeId(message?.threadId),
      replyToMessageId: normalizeId(message?.replyToMessageId),
      raw: message?.raw || message,
    };
    const text = String(message?.content || '');

    return assertInboundMessageEvent({
      type: 'message',
      platformId: 'lark',
      id: messageId,
      actor: {
        id: actorId,
        displayName: String(message?.senderName || actorId),
        isBot: isBotActor(message, getChannel?.()),
        raw: message,
      },
      conversation: {
        id: conversationId,
        parentId,
        tenantId,
        isThread: Boolean(threadId),
        raw: responseTarget,
      },
      rawText: text,
      text,
      attachments: normalizeAttachments(message?.resources, { getChannel }),
      replyToMessageId: normalizeId(message?.replyToMessageId),
      isSystem: false,
      targetsBot: message?.chatType === 'p2p' || Boolean(message?.mentionedBot),
      responseTarget,
      raw: message,
    });
  }

  function normalizeInteraction(interaction) {
    const storedTarget = resolveMessageTarget(normalizeId(interaction?.messageId)) || null;
    const contextConversation = normalizeLarkPrivateConversationContext(storedTarget?.contextConversation)
      || extractLarkPrivateConversationContext(interaction);
    const chatId = normalizeId(interaction?.chatId || interaction?.conversationId || storedTarget?.chatId);
    const actorId = normalizeId(
      interaction?.actorId
      || interaction?.operator?.openId
      || interaction?.operator?.userId,
    );
    const raw = interaction?.raw?.event || interaction?.raw || {};
    const tenantId = normalizeId(
      interaction?.tenantId
      || raw?.tenant_key
      || raw?.tenantKey
      || raw?.header?.tenant_key
      || contextConversation?.tenantId
      || storedTarget?.tenantId,
    );
    if (!chatId || !actorId) {
      throw new TypeError('Lark interaction requires chatId and actorId.');
    }
    const rootId = normalizeId(interaction?.rootId || storedTarget?.rootId);
    const platformThreadId = normalizeId(interaction?.threadId || storedTarget?.threadId);
    const threadId = rootId || platformThreadId;
    const conversationId = contextConversation?.id
      || buildLarkConversationKey({ tenantId, chatId, threadId });
    const conversationTenantId = contextConversation?.tenantId || tenantId;
    const conversationParentId = contextConversation
      ? contextConversation.parentId
      : (threadId ? buildLarkConversationKey({ tenantId, chatId }) : null);
    const conversationIsThread = contextConversation
      ? contextConversation.isThread
      : Boolean(threadId);
    const actionTag = String(interaction?.action?.tag || '').trim().toLowerCase();
    const modalSubmission = resolveLarkModalSubmission(interaction);
    const kind = interaction?.kind === 'command'
      ? 'command'
      : modalSubmission
        ? 'modal'
        : (actionTag.includes('select') || normalizeId(interaction?.action?.option) ? 'select' : 'button');
    const responseTarget = {
      platformId: 'lark',
      id: conversationId,
      chatId,
      chatType: interaction?.chatType || storedTarget?.chatType,
      tenantId,
      messageId: normalizeId(interaction?.messageId),
      rootId,
      threadId: platformThreadId,
      isCard: Boolean(interaction?.isCard) || kind !== 'command',
      ...(contextConversation ? { contextConversation } : {}),
      raw: interaction,
    };
    const event = {
      type: 'interaction',
      platformId: 'lark',
      kind,
      id: normalizeId(interaction?.id || interaction?.messageId) || `lark-${Date.now()}`,
      actor: {
        id: actorId,
        displayName: String(interaction?.actorName || interaction?.operator?.name || actorId),
        isBot: false,
        raw: interaction,
      },
      conversation: {
        id: conversationId,
        parentId: conversationParentId,
        tenantId: conversationTenantId,
        isThread: conversationIsThread,
        raw: contextConversation?.raw || responseTarget,
      },
      responseTarget,
      raw: interaction,
    };
    if (kind === 'command') {
      const options = interaction?.options || {};
      event.command = {
        name: String(interaction?.commandName || '').trim(),
        getOption: (name) => options?.[name] ?? null,
      };
    } else if (kind === 'modal') {
      event.modal = {
        id: modalSubmission.id,
        getField: (name) => modalSubmission.fields?.[String(name || '').trim()] ?? null,
      };
    } else {
      const value = interaction?.action?.value;
      const actionOptions = interaction?.action?.options || raw?.action?.options;
      const selectedOptions = Array.isArray(actionOptions)
        ? actionOptions.filter((option) => String(option || '').trim())
        : [];
      const selectedValues = selectedOptions.length
        ? selectedOptions
        : String(interaction?.action?.option || '').trim()
          ? [interaction.action.option]
          : [];
      event.component = {
        id: String(interaction?.componentId || value?.id || value?.command || interaction?.action?.name || 'lark-action'),
        values: selectedValues.map(String),
      };
    }
    return assertInboundInteractionEvent(event);
  }

  return assertInboundEventNormalizer({ normalizeMessage, normalizeInteraction });
}
