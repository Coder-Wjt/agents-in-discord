import { assertPlatformCapabilities } from './capabilities.js';
import {
  assertInboundEventNormalizer,
  assertInboundMessageEvent,
} from './inbound-event.js';
import {
  MESSAGE_STATUSES,
  assertMessageDelivery,
} from './message-delivery.js';

const POLICY_META = Symbol('runtimeCapabilityPolicy');

function capabilitiesMatch(left, right) {
  return Object.keys(right).every((name) => left?.[name] === right[name]);
}

function markPolicy(value, kind, capabilities) {
  Object.defineProperty(value, POLICY_META, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { kind, capabilities },
  });
  return value;
}

function hasPolicy(value, kind, capabilities) {
  const meta = value?.[POLICY_META];
  return meta?.kind === kind && capabilitiesMatch(meta.capabilities, capabilities);
}

export function createCapabilityAwareMessageDelivery({
  capabilities,
  messageDelivery,
} = {}) {
  const resolvedCapabilities = assertPlatformCapabilities(capabilities);
  const resolvedDelivery = assertMessageDelivery(messageDelivery);
  if (hasPolicy(resolvedDelivery, 'message-delivery', resolvedCapabilities)) {
    return resolvedDelivery;
  }

  const policy = {
    reply: (target, payload) => resolvedDelivery.reply(target, payload),
    send: (target, payload) => resolvedDelivery.send(target, payload),
    edit(target, payload) {
      if (!resolvedCapabilities.messageEdits) return Promise.resolve(target);
      return resolvedDelivery.edit(target, payload);
    },
    startTyping: (target) => resolvedDelivery.startTyping(target),
    splitText: (text, maxChars) => resolvedDelivery.splitText(text, maxChars),
    formatUserMention: (userId) => resolvedDelivery.formatUserMention(userId),
    setMessageStatus(message, status) {
      if (!MESSAGE_STATUSES.includes(status)) {
        throw new TypeError(`Unsupported message status: ${status}`);
      }
      if (!resolvedCapabilities.reactions) return Promise.resolve(message);
      return resolvedDelivery.setMessageStatus(message, status);
    },
  };
  if (typeof resolvedDelivery.getMetricsSnapshot === 'function') {
    policy.getMetricsSnapshot = () => resolvedDelivery.getMetricsSnapshot();
  }
  if (typeof resolvedDelivery.resolveMessageTarget === 'function') {
    policy.resolveMessageTarget = (messageId) => resolvedDelivery.resolveMessageTarget(messageId);
  }
  if (typeof resolvedDelivery.completeModal === 'function') {
    policy.completeModal = (target, payload) => (
      resolvedCapabilities.messageEdits
        ? resolvedDelivery.completeModal(target, payload)
        : resolvedDelivery.send(target, payload)
    );
  }
  return markPolicy(assertMessageDelivery(policy), 'message-delivery', resolvedCapabilities);
}

export function createCapabilityAwareInboundEventNormalizer({
  capabilities,
  eventNormalizer,
} = {}) {
  const resolvedCapabilities = assertPlatformCapabilities(capabilities);
  const resolvedNormalizer = assertInboundEventNormalizer(eventNormalizer);
  if (hasPolicy(resolvedNormalizer, 'inbound-event', resolvedCapabilities)) {
    return resolvedNormalizer;
  }

  return markPolicy(assertInboundEventNormalizer({
    normalizeMessage(message, options) {
      const event = assertInboundMessageEvent(
        resolvedNormalizer.normalizeMessage(message, options),
      );
      if (resolvedCapabilities.attachments || event.attachments.length === 0) {
        return event;
      }
      return assertInboundMessageEvent({
        ...event,
        attachments: [],
      });
    },
    normalizeInteraction: (interaction, options) => (
      resolvedNormalizer.normalizeInteraction(interaction, options)
    ),
  }), 'inbound-event', resolvedCapabilities);
}
