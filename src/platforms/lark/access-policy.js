function normalizeId(value) {
  return String(value || '').trim() || null;
}

export function createLarkAccessPolicy({
  allowedChatIds = null,
  allowedTenantIds = null,
  allowedUserIds = null,
  allowedChannelIds = null,
  allowedGuildIds = null,
} = {}) {
  const chats = allowedChatIds || allowedChannelIds;
  const tenants = allowedTenantIds || allowedGuildIds;

  function isAllowedUser(userId) {
    return !allowedUserIds || allowedUserIds.has(normalizeId(userId));
  }

  function isAllowedChannel(target) {
    if (!chats && !tenants) return true;
    const chatId = normalizeId(target?.chatId || target?.conversationId || target?.id);
    const tenantId = normalizeId(target?.tenantId);
    if (tenantId && tenants?.has(tenantId)) return true;
    return Boolean(chatId && chats?.has(chatId));
  }

  async function isAllowedInteractionChannel(interaction) {
    return isAllowedChannel(interaction?.conversation?.raw || interaction?.responseTarget || interaction);
  }

  return {
    isAllowedUser,
    isAllowedChannel,
    isAllowedInteractionChannel,
  };
}
