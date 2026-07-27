import { buildConversationKey, parseConversationKey } from '../conversation-key.js';

const PRIVATE_CONTEXT_KEY = 'aid_private_context_v1';

function normalizeId(value) {
  return String(value || '').trim() || null;
}

function parseLarkConversationId(value) {
  const id = normalizeId(value);
  if (!id) return null;
  try {
    const parsed = parseConversationKey(id);
    return parsed.platformId === 'lark' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedValues(...values) {
  return values.map(normalizeId).filter(Boolean);
}

function fieldsMatch(values, expected) {
  return values.every((value) => value === expected);
}

function isMatchingParentId(value, parsed) {
  const parentId = normalizeId(value);
  if (!parentId) return true;
  if (!parsed.threadId) return false;
  const parent = parseLarkConversationId(parentId);
  return Boolean(
    parent
    && parent.tenantId === parsed.tenantId
    && parent.conversationId === parsed.conversationId
    && !parent.threadId,
  );
}

export function normalizeLarkPrivateConversationContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const suppliedConversationIds = normalizedValues(value.id, value.conversationId);
  if (!suppliedConversationIds.length || !fieldsMatch(suppliedConversationIds, suppliedConversationIds[0])) {
    return null;
  }
  const parsed = parseLarkConversationId(suppliedConversationIds[0]);
  if (!parsed) return null;
  const raw = value.raw && typeof value.raw === 'object' ? value.raw : {};
  const rawPlatformIds = normalizedValues(raw.platformId);
  const tenantIds = normalizedValues(value.tenantId, raw.tenantId);
  const chatIds = normalizedValues(value.chatId, raw.chatId);
  const rootIds = normalizedValues(value.rootId, raw.rootId);
  if (
    !fieldsMatch(rawPlatformIds, 'lark')
    || !fieldsMatch(tenantIds, parsed.tenantId)
    || !fieldsMatch(chatIds, parsed.conversationId)
    || !fieldsMatch(rootIds, parsed.threadId)
    || !isMatchingParentId(value.parentId, parsed)
  ) {
    return null;
  }
  const isThread = Boolean(parsed.threadId);
  if (typeof value.isThread === 'boolean' && value.isThread !== isThread) return null;
  const suppliedThreadId = normalizeId(value.threadId || raw.threadId);
  if (!isThread && suppliedThreadId) return null;
  const tenantId = parsed.tenantId;
  const chatId = parsed.conversationId;
  const rootId = parsed.threadId;
  const threadId = suppliedThreadId || rootId;
  const conversationId = buildConversationKey({
    platformId: 'lark',
    tenantId,
    conversationId: chatId,
    threadId: rootId,
  });
  const parentId = parsed.threadId
    ? buildConversationKey({
      platformId: 'lark',
      tenantId,
      conversationId: chatId,
    })
    : null;
  const chatType = String(value.chatType || raw.chatType || (isThread ? 'group' : '')).trim() || undefined;
  if (isThread && chatType.toLowerCase() === 'p2p') return null;
  return {
    id: conversationId,
    parentId,
    tenantId,
    isThread,
    raw: {
      platformId: 'lark',
      id: conversationId,
      chatId,
      chatType,
      tenantId,
      rootId,
      threadId,
    },
  };
}

export function createLarkPrivateConversationContext(conversation) {
  if (!conversation || typeof conversation !== 'object') return null;
  return normalizeLarkPrivateConversationContext({
    id: conversation.id,
    parentId: conversation.parentId,
    tenantId: conversation.tenantId,
    isThread: conversation.isThread,
    raw: conversation.raw,
  });
}

function encodeContext(context) {
  const normalized = normalizeLarkPrivateConversationContext(context);
  if (!normalized) return null;
  return JSON.stringify({
    conversationId: normalized.id,
    parentId: normalized.parentId,
    tenantId: normalized.tenantId,
    isThread: normalized.isThread,
    chatId: normalized.raw.chatId,
    chatType: normalized.raw.chatType,
    rootId: normalized.raw.rootId,
    threadId: normalized.raw.threadId,
  });
}

function decodeContext(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return normalizeLarkPrivateConversationContext(parsed);
  } catch {
    return null;
  }
}

function cloneAndEmbed(value, encoded) {
  if (Array.isArray(value)) return value.map((item) => cloneAndEmbed(item, encoded));
  if (!value || typeof value !== 'object') return value;
  const clone = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneAndEmbed(item, encoded)]),
  );
  const tag = String(clone.tag || '').trim().toLowerCase();
  const isAction = tag === 'button' || tag.startsWith('select_');
  if (isAction && !clone.url) {
    const actionValue = clone.value && typeof clone.value === 'object' && !Array.isArray(clone.value)
      ? clone.value
      : {};
    clone.value = { ...actionValue, [PRIVATE_CONTEXT_KEY]: encoded };
  }
  return clone;
}

export function embedLarkPrivateConversationContext(card, context) {
  const encoded = encodeContext(context);
  if (!encoded || !card || typeof card !== 'object') return card;
  return cloneAndEmbed(card, encoded);
}

export function extractLarkPrivateConversationContext(interaction) {
  const visited = new Set();
  let current = interaction;
  for (let depth = 0; current && typeof current === 'object' && depth < 7; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const encoded = current?.action?.value?.[PRIVATE_CONTEXT_KEY]
      || current?.value?.[PRIVATE_CONTEXT_KEY];
    const decoded = decodeContext(encoded);
    if (decoded) return decoded;
    current = current.raw || current.event || null;
  }
  return null;
}

export { PRIVATE_CONTEXT_KEY as LARK_PRIVATE_CONTEXT_KEY };
