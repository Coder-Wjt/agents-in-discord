import {
  assertConversationSecurityDescriptor,
  assertConversationSecurityResolver,
  createUnknownConversationSecurityDescriptor,
} from '../conversation-security.js';

function normalizeId(value) {
  return String(value || '').trim() || null;
}

function resolveConversation(source) {
  return source?.conversation || source?.inboundEvent?.conversation || null;
}

function resolveRawTarget(source) {
  const conversation = resolveConversation(source);
  return conversation?.raw || source?.responseTarget || source || null;
}

export function createLarkConversationSecurity() {
  function resolve(source) {
    const conversation = resolveConversation(source);
    const target = resolveRawTarget(source);
    if (!target) {
      return createUnknownConversationSecurityDescriptor({
        conversationId: conversation?.id,
        parentConversationId: conversation?.parentId,
        tenantId: conversation?.tenantId,
        reason: 'Lark chat unavailable',
      });
    }
    const chatType = String(target?.chatType || '').trim().toLowerCase();
    const isDirect = chatType === 'p2p';
    return assertConversationSecurityDescriptor({
      conversationId: normalizeId(target?.chatId || conversation?.id || target?.id),
      parentConversationId: normalizeId(target?.parentChatId || conversation?.parentId),
      tenantId: normalizeId(conversation?.tenantId || target?.tenantId),
      available: true,
      isDirect,
      visibility: isDirect ? 'unknown' : 'team',
      reason: isDirect ? 'Lark direct chat' : 'Lark group membership',
    });
  }
  return assertConversationSecurityResolver({ resolve });
}
