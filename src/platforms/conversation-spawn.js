export const CONVERSATION_SPAWN_METHODS = Object.freeze([
  'canSpawn',
  'spawn',
  'rename',
  'remove',
  'archive',
  'send',
  'listRecentMessages',
  'splitText',
  'createPromptMessage',
  'formatUserMention',
  'formatConversationReference',
]);

export function assertConversationSpawn(conversationSpawn) {
  if (!conversationSpawn || typeof conversationSpawn !== 'object' || Array.isArray(conversationSpawn)) {
    throw new TypeError('Conversation spawn port must be an object.');
  }

  for (const method of CONVERSATION_SPAWN_METHODS) {
    if (typeof conversationSpawn[method] !== 'function') {
      throw new TypeError(`Conversation spawn port must provide ${method}().`);
    }
  }

  return conversationSpawn;
}

export function assertSpawnedConversation(conversation) {
  if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) {
    throw new TypeError('Spawned conversation must be an object.');
  }
  if (!String(conversation.id || '').trim()) {
    throw new TypeError('Spawned conversation id must be a non-empty string.');
  }
  if (!conversation.raw || typeof conversation.raw !== 'object') {
    throw new TypeError('Spawned conversation raw target must be an object.');
  }
  return conversation;
}

export function assertConversationHistoryMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('Conversation history message must be an object.');
  }
  if (typeof message.id !== 'string' || !message.id.trim()) {
    throw new TypeError('Conversation history message id must be a non-empty string.');
  }
  if (typeof message.text !== 'string') {
    throw new TypeError('Conversation history message text must be a string.');
  }
  if (!Number.isFinite(message.createdAtMs) || message.createdAtMs < 0) {
    throw new TypeError('Conversation history message createdAtMs must be a non-negative number.');
  }
  if (!message.actor || typeof message.actor !== 'object' || Array.isArray(message.actor)) {
    throw new TypeError('Conversation history message actor must be an object.');
  }
  if (
    message.actor.id !== null
    && message.actor.id !== undefined
    && (typeof message.actor.id !== 'string' || !message.actor.id.trim())
  ) {
    throw new TypeError('Conversation history message actor.id must be null or a non-empty string.');
  }
  if (typeof message.actor.isBot !== 'boolean') {
    throw new TypeError('Conversation history message actor.isBot must be a boolean.');
  }
  if (
    message.actor.isCurrentBot !== null
    && message.actor.isCurrentBot !== undefined
    && typeof message.actor.isCurrentBot !== 'boolean'
  ) {
    throw new TypeError('Conversation history message actor.isCurrentBot must be null or a boolean.');
  }
  return message;
}

export function assertConversationHistory(messages) {
  if (!Array.isArray(messages)) {
    throw new TypeError('Conversation history must be an array.');
  }
  for (const message of messages) assertConversationHistoryMessage(message);
  return messages;
}
