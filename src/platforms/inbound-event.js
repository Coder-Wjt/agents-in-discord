export const INBOUND_INTERACTION_KINDS = Object.freeze([
  'command',
  'button',
  'select',
  'modal',
  'unknown',
]);

function assertInboundActorAndConversation(event, label) {
  if (!event.actor || typeof event.actor !== 'object' || !String(event.actor.id || '').trim()) {
    throw new TypeError(`${label} actor.id must be a non-empty string.`);
  }
  if (!event.conversation || typeof event.conversation !== 'object' || !String(event.conversation.id || '').trim()) {
    throw new TypeError(`${label} conversation.id must be a non-empty string.`);
  }
  if (typeof event.conversation.isThread !== 'boolean') {
    throw new TypeError(`${label} conversation.isThread must be a boolean.`);
  }
  if (
    event.conversation.parentId !== null
    && event.conversation.parentId !== undefined
    && !String(event.conversation.parentId || '').trim()
  ) {
    throw new TypeError(`${label} conversation.parentId must be null or a non-empty string.`);
  }
}

export function assertInboundMessageEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Inbound message event must be an object.');
  }
  if (event.type !== 'message') {
    throw new TypeError('Inbound message event type must be "message".');
  }
  if (typeof event.platformId !== 'string' || !event.platformId.trim()) {
    throw new TypeError('Inbound message event platformId must be a non-empty string.');
  }
  if (typeof event.id !== 'string' || !event.id.trim()) {
    throw new TypeError('Inbound message event id must be a non-empty string.');
  }
  assertInboundActorAndConversation(event, 'Inbound message event');
  if (typeof event.text !== 'string' || typeof event.rawText !== 'string') {
    throw new TypeError('Inbound message event text and rawText must be strings.');
  }
  if (!Array.isArray(event.attachments)) {
    throw new TypeError('Inbound message event attachments must be an array.');
  }
  if (
    event.replyToMessageId !== null
    && event.replyToMessageId !== undefined
    && (typeof event.replyToMessageId !== 'string' || !event.replyToMessageId.trim())
  ) {
    throw new TypeError('Inbound message event replyToMessageId must be null or a non-empty string.');
  }
  if (typeof event.isSystem !== 'boolean' || typeof event.targetsBot !== 'boolean') {
    throw new TypeError('Inbound message event flags must be booleans.');
  }
  return event;
}

export function createInboundMessageContext(event) {
  const resolvedEvent = assertInboundMessageEvent(event);

  return {
    id: resolvedEvent.id,
    platformId: resolvedEvent.platformId,
    content: resolvedEvent.text,
    actor: resolvedEvent.actor,
    conversation: resolvedEvent.conversation,
    attachments: resolvedEvent.attachments,
    replyToMessageId: normalizeOptionalMessageId(resolvedEvent.replyToMessageId),
    responseTarget: resolvedEvent.responseTarget || resolvedEvent.raw || null,
    inboundEvent: resolvedEvent,
  };
}

function normalizeOptionalMessageId(value) {
  return String(value || '').trim() || null;
}

function getInboundMessageEnvelope(message) {
  if (message?.type === 'message' && message?.actor && message?.conversation) return message;
  return message?.inboundEvent?.type === 'message' ? message.inboundEvent : null;
}

export function getInboundActorId(event) {
  return String(
    event?.actor?.id
    || event?.inboundEvent?.actor?.id
    || '',
  ).trim();
}

export function getInboundMessageActorId(message) {
  return getInboundActorId(message);
}

export function getInboundMessageConversation(message) {
  const event = getInboundMessageEnvelope(message);
  return message?.conversation || event?.conversation || null;
}

export function getInboundMessageConversationId(message) {
  const conversation = getInboundMessageConversation(message);
  return String(conversation?.id || '').trim();
}

export function getInboundMessageConversationTarget(message) {
  const conversation = getInboundMessageConversation(message);
  return conversation?.raw || null;
}

export function getInboundMessageAttachments(message) {
  const event = getInboundMessageEnvelope(message);
  const attachments = message?.attachments ?? event?.attachments;
  if (Array.isArray(attachments)) return attachments;
  return [];
}

export function getInboundMessageReplyToMessageId(message) {
  const event = getInboundMessageEnvelope(message);
  return normalizeOptionalMessageId(
    message?.replyToMessageId
    || event?.replyToMessageId,
  );
}

export function assertInboundInteractionEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Inbound interaction event must be an object.');
  }
  if (event.type !== 'interaction') {
    throw new TypeError('Inbound interaction event type must be "interaction".');
  }
  if (!INBOUND_INTERACTION_KINDS.includes(event.kind)) {
    throw new TypeError(`Unsupported inbound interaction kind: ${event.kind}`);
  }
  if (typeof event.platformId !== 'string' || !event.platformId.trim()) {
    throw new TypeError('Inbound interaction event platformId must be a non-empty string.');
  }
  if (typeof event.id !== 'string' || !event.id.trim()) {
    throw new TypeError('Inbound interaction event id must be a non-empty string.');
  }
  assertInboundActorAndConversation(event, 'Inbound interaction event');

  if (event.kind === 'command') {
    if (!event.command || !String(event.command.name || '').trim()) {
      throw new TypeError('Inbound command interaction must provide command.name.');
    }
    if (typeof event.command.getOption !== 'function') {
      throw new TypeError('Inbound command interaction must provide command.getOption().');
    }
  }
  if (event.kind === 'button' || event.kind === 'select') {
    if (!event.component || !String(event.component.id || '').trim()) {
      throw new TypeError('Inbound component interaction must provide component.id.');
    }
    if (!Array.isArray(event.component.values)) {
      throw new TypeError('Inbound component interaction values must be an array.');
    }
  }
  if (event.kind === 'modal') {
    if (!event.modal || !String(event.modal.id || '').trim()) {
      throw new TypeError('Inbound modal interaction must provide modal.id.');
    }
    if (typeof event.modal.getField !== 'function') {
      throw new TypeError('Inbound modal interaction must provide modal.getField().');
    }
  }
  return event;
}

export function getInboundInteractionOption(event, name) {
  const value = event?.command?.getOption?.(String(name || '').trim());
  return value === undefined || value === null ? null : String(value);
}

export function getInboundInteractionField(event, name) {
  const value = event?.modal?.getField?.(String(name || '').trim());
  return value === undefined || value === null ? '' : String(value);
}

export function getInboundInteractionActorId(event) {
  return getInboundActorId(event);
}

export function getInboundInteractionChannel(event) {
  return event?.conversation?.raw || null;
}

export function getInboundInteractionComponentId(event) {
  return String(event?.component?.id || '').trim();
}

export function getInboundInteractionValues(event) {
  return Array.isArray(event?.component?.values)
    ? [...event.component.values]
    : [];
}

export function assertInboundEventNormalizer(eventNormalizer) {
  if (!eventNormalizer || typeof eventNormalizer !== 'object' || Array.isArray(eventNormalizer)) {
    throw new TypeError('Inbound event normalizer must be an object.');
  }
  if (typeof eventNormalizer.normalizeMessage !== 'function') {
    throw new TypeError('Inbound event normalizer must provide normalizeMessage().');
  }
  if (typeof eventNormalizer.normalizeInteraction !== 'function') {
    throw new TypeError('Inbound event normalizer must provide normalizeInteraction().');
  }
  return eventNormalizer;
}
