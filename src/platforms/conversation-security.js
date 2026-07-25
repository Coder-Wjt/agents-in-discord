export const CONVERSATION_VISIBILITIES = Object.freeze([
  'public',
  'team',
  'unknown',
]);

function normalizeOptionalId(value) {
  return String(value || '').trim() || null;
}

export function assertConversationSecurityDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError('Conversation security descriptor must be an object.');
  }
  if (typeof descriptor.available !== 'boolean') {
    throw new TypeError('Conversation security descriptor available must be a boolean.');
  }
  if (typeof descriptor.isDirect !== 'boolean') {
    throw new TypeError('Conversation security descriptor isDirect must be a boolean.');
  }
  if (!CONVERSATION_VISIBILITIES.includes(descriptor.visibility)) {
    throw new TypeError(`Unsupported conversation visibility: ${descriptor.visibility}`);
  }
  if (typeof descriptor.reason !== 'string' || !descriptor.reason.trim()) {
    throw new TypeError('Conversation security descriptor reason must be a non-empty string.');
  }
  for (const field of ['conversationId', 'parentConversationId', 'tenantId']) {
    if (
      descriptor[field] !== null
      && descriptor[field] !== undefined
      && !normalizeOptionalId(descriptor[field])
    ) {
      throw new TypeError(`Conversation security descriptor ${field} must be null or a non-empty string.`);
    }
  }
  return descriptor;
}

export function assertConversationSecurityResolver(resolver) {
  if (!resolver || typeof resolver !== 'object' || Array.isArray(resolver)) {
    throw new TypeError('Conversation security resolver must be an object.');
  }
  if (typeof resolver.resolve !== 'function') {
    throw new TypeError('Conversation security resolver must provide resolve().');
  }
  return resolver;
}

export function createUnknownConversationSecurityDescriptor({
  conversationId = null,
  parentConversationId = null,
  tenantId = null,
  available = false,
  reason = 'conversation unavailable',
} = {}) {
  return assertConversationSecurityDescriptor({
    conversationId: normalizeOptionalId(conversationId),
    parentConversationId: normalizeOptionalId(parentConversationId),
    tenantId: normalizeOptionalId(tenantId),
    available: Boolean(available),
    isDirect: false,
    visibility: 'unknown',
    reason: String(reason || '').trim() || 'conversation unavailable',
  });
}

export const DEFAULT_CONVERSATION_SECURITY_RESOLVER = Object.freeze({
  resolve(source) {
    const conversation = source?.conversation || source?.inboundEvent?.conversation || null;
    return createUnknownConversationSecurityDescriptor({
      conversationId: conversation?.id,
      parentConversationId: conversation?.parentId,
      tenantId: conversation?.tenantId,
      available: Boolean(source || conversation),
      reason: source || conversation ? 'visibility unavailable' : 'conversation unavailable',
    });
  },
});
