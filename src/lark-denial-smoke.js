import crypto from 'node:crypto';

import { createLarkEntryHandlers } from './lark-entry-handlers.js';
import { createLarkAccessPolicy } from './platforms/lark/access-policy.js';
import { createLarkCommandViewRenderer } from './platforms/lark/command-view-renderer.js';
import { createLarkInboundEventNormalizer } from './platforms/lark/inbound-event.js';
import { createLarkInteractionResponse } from './platforms/lark/interaction-response.js';
import { createLarkMessageDelivery } from './platforms/lark/message-delivery.js';

const SAFE_ERROR_MESSAGES = Object.freeze({
  lark_denial_smoke_cli_error: 'lark-cli operation failed.',
  lark_denial_smoke_cli_unavailable: 'lark-cli is unavailable.',
  lark_denial_smoke_identity_unavailable: 'Ready bot and user identities are required.',
  lark_denial_smoke_delivery_failed: 'The private denial could not be verified.',
  lark_denial_smoke_shared_mutation: 'The denial path attempted to mutate the shared card.',
  lark_denial_smoke_consumer_started: 'The denial smoke unexpectedly started an event consumer.',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeIdentityStatus(identity) {
  return normalizeText(identity?.status).toLowerCase();
}

function normalizeMessageItems(payload) {
  const items = Array.isArray(payload)
    ? payload
    : payload?.data?.items || payload?.data?.messages || payload?.items || payload?.messages;
  return Array.isArray(items) ? items : (payload?.data ? [payload.data] : []);
}

export function parseLarkDenialSmokeArgs(argv = []) {
  const options = {
    apply: false,
    help: false,
    json: false,
  };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new TypeError(`Unknown option: ${arg}`);
  }
  return options;
}

export function inspectLarkDenialSmokeAuth(authPayload, userPayload) {
  const bot = authPayload?.identities?.bot || {};
  const user = authPayload?.identities?.user || {};
  const actorOpenId = normalizeText(
    userPayload?.onBehalfOf?.openId
    || userPayload?.on_behalf_of?.open_id
    || user?.openId
    || user?.open_id,
  );
  const botReady = bot.available === true && normalizeIdentityStatus(bot) === 'ready';
  const userReady = user.available === true
    && normalizeIdentityStatus(user) === 'ready'
    && Boolean(actorOpenId);
  return {
    ok: botReady && userReady,
    botReady,
    userReady,
    actorOpenId,
  };
}

export function verifyLarkDenialMessage(payload, {
  messageId,
  marker = '没有权限',
} = {}) {
  const expectedId = normalizeText(messageId);
  const expectedMarker = normalizeText(marker);
  if (!expectedId || !expectedMarker) return false;
  return normalizeMessageItems(payload).some((message) => {
    const id = normalizeText(message?.message_id || message?.messageId);
    const content = normalizeText(message?.body?.content || message?.content);
    return id === expectedId && content.includes(expectedMarker);
  });
}

export function formatLarkDenialSmokeError(error) {
  return SAFE_ERROR_MESSAGES[normalizeText(error?.code)] || 'Lark private-denial smoke failed.';
}

export async function runLarkDenialSmoke({
  channel,
  actorOpenId,
  verifySentMessage = async () => true,
  logger = { log() {}, warn() {}, error() {} },
} = {}) {
  const actorId = normalizeText(actorOpenId);
  if (!channel || typeof channel.send !== 'function') {
    throw new TypeError('Lark denial smoke requires a CLI channel.');
  }
  if (!actorId) throw new TypeError('Lark denial smoke requires an actor open ID.');
  if (typeof verifySentMessage !== 'function') {
    throw new TypeError('Lark denial smoke requires verifySentMessage().');
  }

  let sharedUpdateAttempts = 0;
  let lastSend = null;
  const smokeChannel = {
    botIdentity: channel.botIdentity,
    getConnectionStatus: channel.getConnectionStatus?.bind(channel),
    async send(...args) {
      lastSend = await channel.send(...args);
      return lastSend;
    },
    async updateCard(...args) {
      sharedUpdateAttempts += 1;
      return channel.updateCard?.(...args);
    },
    async editMessage(...args) {
      sharedUpdateAttempts += 1;
      return channel.editMessage?.(...args);
    },
  };
  const renderer = createLarkCommandViewRenderer();
  const messageDelivery = createLarkMessageDelivery({
    getChannel: () => smokeChannel,
    commandViewRenderer: renderer,
  });
  const normalizer = createLarkInboundEventNormalizer({
    getChannel: () => smokeChannel,
    resolveMessageTarget: messageDelivery.resolveMessageTarget,
  });
  const handlers = createLarkEntryHandlers({
    accessPolicy: createLarkAccessPolicy({
      allowedUserIds: new Set(['ou_intentionally_not_the_smoke_actor']),
    }),
    interactionResponse: createLarkInteractionResponse({ messageDelivery }),
    messageDelivery,
    normalizeInteractionEvent: normalizer.normalizeInteraction,
    normalizeMessageEvent: normalizer.normalizeMessage,
    isSettingsPanelComponentId: (id) => normalizeText(id).startsWith('settings:'),
    logger,
  });
  const beforeStatus = channel.getConnectionStatus?.() || {};

  await handlers.handleInteractionCreate({
    id: `evt_${crypto.randomBytes(8).toString('hex')}`,
    messageId: `om_${crypto.randomBytes(12).toString('hex')}`,
    chatId: `oc_${crypto.randomBytes(12).toString('hex')}`,
    chatType: 'group',
    actorId,
    action: { tag: 'button', value: { id: 'settings:open' } },
  });

  const afterStatus = channel.getConnectionStatus?.() || {};
  const consumerFree = Number(beforeStatus.consumerCount || 0) === 0
    && Number(afterStatus.consumerCount || 0) === 0
    && !['connecting', 'connected', 'reconnecting'].includes(normalizeText(afterStatus.state));
  if (!consumerFree) {
    const error = new Error('Lark denial smoke started a consumer.');
    error.code = 'lark_denial_smoke_consumer_started';
    throw error;
  }
  if (sharedUpdateAttempts !== 0) {
    const error = new Error('Lark denial smoke attempted a shared update.');
    error.code = 'lark_denial_smoke_shared_mutation';
    throw error;
  }
  const sentMessageId = normalizeText(lastSend?.messageId || lastSend?.message_id);
  const sentChatId = normalizeText(lastSend?.chatId || lastSend?.chat_id);
  if (!sentMessageId || !sentChatId || !(await verifySentMessage({
    messageId: sentMessageId,
    chatId: sentChatId,
  }))) {
    const error = new Error('Lark denial smoke delivery verification failed.');
    error.code = 'lark_denial_smoke_delivery_failed';
    throw error;
  }
  const metrics = messageDelivery.getMetricsSnapshot();
  const privateSends = Number(metrics.byOperation?.send?.succeeded || 0);
  const ok = privateSends === 1 && metrics.failed === 0;
  if (!ok) {
    const error = new Error('Lark denial smoke private send failed.');
    error.code = 'lark_denial_smoke_delivery_failed';
    throw error;
  }
  return {
    ok: true,
    privateSends,
    sharedUpdateAttempts,
    deliveryVerified: true,
    consumerFree,
    syntheticCallback: true,
    realBotDm: true,
  };
}
