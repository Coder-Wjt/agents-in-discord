import { PermissionFlagsBits as DiscordPermissionFlagsBits } from 'discord.js';

import {
  assertConversationSecurityDescriptor,
  assertConversationSecurityResolver,
  createUnknownConversationSecurityDescriptor,
} from '../conversation-security.js';

function normalizeId(value) {
  return String(value || '').trim() || null;
}

function getNormalizedConversation(source) {
  return source?.conversation || source?.inboundEvent?.conversation || null;
}

function getDiscordChannel(source) {
  const conversation = getNormalizedConversation(source);
  if (conversation?.raw) return conversation.raw;
  if (source?.channel) return source.channel;
  return source || null;
}

function resolveBaseChannel(channel) {
  return channel?.isThread?.() ? (channel.parent || null) : channel;
}

export function createDiscordConversationSecurity({
  permissionFlagsBits = DiscordPermissionFlagsBits,
} = {}) {
  function resolve(source) {
    const conversation = getNormalizedConversation(source);
    const channel = getDiscordChannel(source);
    if (!channel) {
      return createUnknownConversationSecurityDescriptor({
        conversationId: conversation?.id,
        parentConversationId: conversation?.parentId,
        tenantId: conversation?.tenantId,
        reason: 'channel unavailable',
      });
    }

    const baseChannel = resolveBaseChannel(channel);
    const target = baseChannel || channel;
    const guild = target?.guild || channel?.guild || null;
    const descriptor = {
      conversationId: normalizeId(conversation?.id || channel?.id),
      parentConversationId: normalizeId(
        conversation?.parentId
        || channel?.parentId
        || (baseChannel && baseChannel !== channel ? baseChannel.id : null),
      ),
      tenantId: normalizeId(conversation?.tenantId || guild?.id),
      available: true,
      isDirect: Boolean(channel?.isDMBased?.()),
      visibility: 'unknown',
      reason: 'missing guild context',
    };

    if (descriptor.isDirect) {
      descriptor.reason = 'dm channel';
      return assertConversationSecurityDescriptor(descriptor);
    }
    if (!guild) return assertConversationSecurityDescriptor(descriptor);

    const everyoneRole = guild.roles?.everyone;
    if (!everyoneRole) {
      descriptor.reason = 'missing @everyone role';
      return assertConversationSecurityDescriptor(descriptor);
    }

    const perms = target?.permissionsFor?.(everyoneRole);
    if (!perms) {
      descriptor.reason = 'permissions unavailable';
      return assertConversationSecurityDescriptor(descriptor);
    }

    const viewChannelFlag = permissionFlagsBits.ViewChannel;
    if (viewChannelFlag === null || viewChannelFlag === undefined) {
      descriptor.reason = 'ViewChannel permission flag unavailable';
      return assertConversationSecurityDescriptor(descriptor);
    }

    const canView = perms.has(viewChannelFlag, true);
    descriptor.visibility = canView ? 'public' : 'team';
    descriptor.reason = canView
      ? '@everyone can view channel'
      : '@everyone cannot view channel';
    return assertConversationSecurityDescriptor(descriptor);
  }

  return assertConversationSecurityResolver({ resolve });
}
