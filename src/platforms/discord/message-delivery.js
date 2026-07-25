import { splitForDiscord } from '../../discord-message-splitter.js';
import { safeChannelSend, safeReply } from '../../discord-reply-utils.js';
import { assertMessageDelivery, MESSAGE_STATUSES } from '../message-delivery.js';
import { assertCommandViewRenderer } from '../command-view.js';

const STATUS_EMOJI = Object.freeze({
  processing: '⚡',
  succeeded: '✅',
  cancelled: '🛑',
  failed: '❌',
  dequeued: '🗑️',
});

export function createDiscordMessageDelivery({
  reply = safeReply,
  send = safeChannelSend,
  edit = async (target, payload) => target.edit(payload),
  commandViewRenderer = null,
  splitText = splitForDiscord,
  getCurrentUserId = null,
  typingIntervalMs = 8000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const renderer = commandViewRenderer
    ? assertCommandViewRenderer(commandViewRenderer)
    : null;

  function renderPayload(payload) {
    const isCommandView = payload?.type === 'message'
      || (payload && typeof payload === 'object' && ('rows' in payload || 'visibility' in payload));
    if (!isCommandView) return payload;
    if (!renderer) {
      throw new TypeError('Discord message delivery requires commandViewRenderer for command message views.');
    }
    return renderer.renderMessage(payload);
  }

  const resolveDeliveryTarget = (target) => target?.responseTarget || target;
  const replyWithRendering = (target, payload) => reply(resolveDeliveryTarget(target), renderPayload(payload));
  const sendWithRendering = (target, payload) => send(resolveDeliveryTarget(target), renderPayload(payload));
  const editWithRendering = (target, payload) => edit(resolveDeliveryTarget(target), renderPayload(payload));

  function resolveCurrentUserId(message) {
    const explicit = String(getCurrentUserId?.() || '').trim();
    if (explicit) return explicit;
    return String(
      message?.client?.user?.id
      || message?.channel?.client?.user?.id
      || '',
    ).trim() || null;
  }

  function startTyping(target) {
    const deliveryTarget = resolveDeliveryTarget(target);
    const sendTyping = deliveryTarget?.channel?.sendTyping;
    if (typeof sendTyping !== 'function') return () => {};

    const emit = () => {
      try {
        void Promise.resolve(sendTyping.call(deliveryTarget.channel)).catch(() => {});
      } catch {
        // Typing indicators are best-effort.
      }
    };

    emit();
    const timer = setIntervalFn(emit, Math.max(1000, Number(typingIntervalMs) || 8000));
    timer?.unref?.();
    return () => clearIntervalFn(timer);
  }

  function formatUserMention(userId) {
    const normalized = String(userId || '').trim();
    return normalized ? `<@${normalized}>` : '';
  }

  async function setMessageStatus(message, status) {
    if (!MESSAGE_STATUSES.includes(status)) {
      throw new TypeError(`Unsupported message status: ${status}`);
    }

    const deliveryTarget = resolveDeliveryTarget(message);

    if (status !== 'processing') {
      const currentUserId = resolveCurrentUserId(deliveryTarget);
      if (currentUserId) {
        await deliveryTarget?.reactions?.cache?.get(STATUS_EMOJI.processing)
          ?.users?.remove(currentUserId)
          .catch(() => {});
      }
    }

    const emoji = STATUS_EMOJI[status];
    if (emoji && typeof deliveryTarget?.react === 'function') {
      await deliveryTarget.react(emoji);
    }
  }

  return assertMessageDelivery({
    reply: replyWithRendering,
    send: sendWithRendering,
    edit: editWithRendering,
    startTyping,
    splitText,
    formatUserMention,
    setMessageStatus,
  });
}
