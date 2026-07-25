const CONVERSATION_KEY_PREFIX = 'platform';
const CONVERSATION_KEY_VERSION = 'v1';

function normalizeRequiredField(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeOptionalField(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function buildConversationKey({
  platformId,
  tenantId = null,
  conversationId,
  threadId = null,
} = {}) {
  const fields = [
    normalizeRequiredField(platformId, 'platformId'),
    normalizeOptionalField(tenantId),
    normalizeRequiredField(conversationId, 'conversationId'),
    normalizeOptionalField(threadId),
  ];

  return [
    CONVERSATION_KEY_PREFIX,
    CONVERSATION_KEY_VERSION,
    ...fields.map((field) => encodeURIComponent(field)),
  ].join(':');
}

export function parseConversationKey(key) {
  const normalized = String(key ?? '');
  const parts = normalized.split(':');
  if (
    parts.length !== 6
    || parts[0] !== CONVERSATION_KEY_PREFIX
    || parts[1] !== CONVERSATION_KEY_VERSION
  ) {
    throw new TypeError('Invalid platform conversation key.');
  }

  let decoded;
  try {
    decoded = parts.slice(2).map((field) => decodeURIComponent(field));
  } catch {
    throw new TypeError('Invalid platform conversation key encoding.');
  }

  const [platformId, tenantId, conversationId, threadId] = decoded;
  return {
    platformId: normalizeRequiredField(platformId, 'platformId'),
    tenantId: tenantId || null,
    conversationId: normalizeRequiredField(conversationId, 'conversationId'),
    threadId: threadId || null,
  };
}
