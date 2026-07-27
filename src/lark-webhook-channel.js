import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

const WEBHOOK_EXTENSION_MARK = Symbol.for('agents-in-discord.lark-webhook');
const LEGACY_CARD_CALLBACK_CONTEXT = new AsyncLocalStorage();

function normalizeWebhookPath(value) {
  const path = String(value || '/lark/events').trim() || '/lark/events';
  return path.startsWith('/') ? path : `/${path}`;
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('end', () => {
      if (tooLarge) {
        const error = new Error(`Lark webhook request exceeds ${maxBodyBytes} bytes.`);
        error.code = 'payload_too_large';
        reject(error);
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        error.code = 'invalid_json';
        reject(error);
      }
    });
  });
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) return;
  const body = JSON.stringify(payload ?? {});
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function formatRejectionLog(error) {
  const code = String(error?.code || '').trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
  return code
    ? `Lark webhook request rejected (${code}).`
    : 'Lark webhook request rejected.';
}

function hashLogIdentifier(value) {
  const normalized = String(value || '').trim();
  return normalized
    ? createHash('sha256').update(normalized).digest('hex').slice(0, 12)
    : 'none';
}

function formatDeferredCardUpdateError(messageId, error) {
  const code = String(error?.code || '').trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
  return [
    '[lark-card-persist] status=failed',
    `messageHash=${hashLogIdentifier(messageId)}`,
    `code=${code || 'unknown'}`,
  ].join(' ');
}

function formatEnvelopeShape(data) {
  const rootKeys = Object.keys(data || {})
    .map((key) => String(key).replace(/[^a-z0-9_-]/gi, '_').slice(0, 32))
    .filter(Boolean)
    .sort()
    .slice(0, 24)
    .join(',') || 'none';
  const eventKeys = Object.keys(data?.event || {})
    .map((key) => String(key).replace(/[^a-z0-9_-]/gi, '_').slice(0, 32))
    .filter(Boolean)
    .sort()
    .slice(0, 24)
    .join(',') || 'none';
  const hasSignature = Boolean(String(data?.headers?.['x-lark-signature'] || '').trim());
  return [
    `signed=${hasSignature}`,
    `schema=${Boolean(data?.schema)}`,
    `encrypted=${Boolean(data?.encrypt)}`,
    `rootAction=${Boolean(data?.action)}`,
    `eventAction=${Boolean(data?.event?.action)}`,
    `rootKeys=${rootKeys}`,
    `eventKeys=${eventKeys}`,
  ].join(' ');
}

function resolveLegacyCardActionIdentity(data) {
  return {
    messageId: String(data?.context?.open_message_id || data?.open_message_id || '').trim(),
    chatId: String(data?.context?.open_chat_id || data?.open_chat_id || '').trim(),
    actorId: String(data?.operator?.open_id || data?.open_id || '').trim(),
  };
}

function isCardActionPayload(data) {
  if (!data?.action || typeof data.action !== 'object') return false;
  const { messageId, actorId } = resolveLegacyCardActionIdentity(data);
  return Boolean(messageId && actorId);
}

function isLegacyCardActionEnvelope(data) {
  return !data?.schema && !data?.encrypt && isCardActionPayload(data);
}

function normalizeLegacyCardAction(data, { headers = data?.headers } = {}) {
  const { messageId, chatId, actorId } = resolveLegacyCardActionIdentity(data);
  const timestamp = String(headers?.['x-lark-request-timestamp'] || '').trim();
  const nonce = String(headers?.['x-lark-request-nonce'] || '').trim();
  const eventId = String(data?.event_id || '').trim()
    || (timestamp && nonce ? `legacy-card:${timestamp}:${nonce}` : null);
  return {
    id: eventId || `${messageId}:${actorId}`,
    messageId,
    ...(chatId ? { chatId } : {}),
    tenantId: data?.tenant_key,
    operator: {
      openId: actorId,
      userId: data?.operator?.user_id || data?.user_id,
      name: data?.operator?.name || data?.operator_name,
    },
    action: {
      value: data?.action?.value,
      tag: data?.action?.tag || 'unknown',
      name: data?.action?.name,
      option: data?.action?.option,
      ...(Array.isArray(data?.action?.options) ? { options: data.action.options } : {}),
      ...(data?.action?.form_value ? { formValue: data.action.form_value } : {}),
    },
    token: data?.token || data?.verification_token,
    raw: {
      ...data,
      ...(eventId ? { event_id: eventId } : {}),
    },
  };
}

async function dispatchLegacyCardAction(channel, data, options) {
  const handler = channel?.handlers?.cardAction;
  if (typeof handler !== 'function') {
    const error = new Error('Lark webhook card action handler is unavailable.');
    error.code = 'card_action_handler_unavailable';
    throw error;
  }
  const event = normalizeLegacyCardAction(data, options);
  const context = {
    channel,
    messageId: event.messageId,
    responseCard: null,
    deferredCardUpdates: [],
  };
  const result = await LEGACY_CARD_CALLBACK_CONTEXT.run(context, () => handler(event));
  return {
    result: context.responseCard || result,
    deferredCardUpdates: context.deferredCardUpdates,
  };
}

function scheduleDeferredCardUpdates(response, updates, logger) {
  const pending = Array.isArray(updates) ? updates.filter(Boolean) : [];
  if (!pending.length) return;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    for (const update of pending) {
      setImmediate(() => {
        void Promise.resolve()
          .then(() => update.run())
          .catch((error) => logger.warn?.(formatDeferredCardUpdateError(update.messageId, error)));
      });
    }
  };
  response.once('finish', start);
  response.once('close', start);
}

function validateRequestEnvelope(dispatcher, data, {
  allowUnsigned = false,
  cardAction = false,
} = {}) {
  const requestHandle = dispatcher?.requestHandle;
  let signatureVerified = false;
  const hasSignature = Boolean(String(data?.headers?.['x-lark-signature'] || '').trim());
  const validateSignature = cardAction
    ? requestHandle?.checkIsCardEventValidated
    : requestHandle?.checkIsEventValidated;
  let signatureAuthenticated = false;
  if (typeof validateSignature === 'function') {
    if ((!allowUnsigned || hasSignature) && !validateSignature.call(requestHandle, data)) {
      const error = new Error('Lark webhook signature verification failed.');
      error.code = 'verification_failed';
      error.verificationStage = 'signature';
      error.verificationMethod = cardAction ? 'card' : 'event';
      throw error;
    }
    signatureVerified = hasSignature;
    const signatureSecretConfigured = cardAction && !data?.schema && !data?.encrypt
      ? Boolean(String(dispatcher?.verificationToken || '').trim())
      : Boolean(String(dispatcher?.encryptKey || '').trim());
    signatureAuthenticated = hasSignature && signatureSecretConfigured;
  }
  const verificationToken = String(dispatcher?.verificationToken || '').trim();
  if (!verificationToken || typeof requestHandle?.parse !== 'function') {
    return { signatureVerified, signatureAuthenticated, parsed: data, cardAction: false };
  }
  const parsed = requestHandle.parse(data);
  const parsedCardAction = isCardActionPayload(parsed);
  const receivedToken = String(parsed?.token || parsed?.verification_token || '').trim();
  if (receivedToken !== verificationToken && !(parsedCardAction && signatureAuthenticated)) {
    const error = new Error('Lark webhook verification token mismatch.');
    error.code = 'verification_failed';
    error.verificationStage = 'token';
    error.verificationMethod = cardAction ? 'card' : 'event';
    throw error;
  }
  return {
    signatureVerified,
    signatureAuthenticated,
    parsed,
    cardAction: parsedCardAction,
  };
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export function installLarkWebhookServer(channel, {
  host = '127.0.0.1',
  port = 3000,
  path = '/lark/events',
  healthPath = '/healthz',
  maxBodyBytes = 1024 * 1024,
  headersTimeoutMs = 10_000,
  requestTimeoutMs = 15_000,
  keepAliveTimeoutMs = 5000,
  createServer = http.createServer,
  generateChallenge = null,
  onVerifiedRequest = async () => false,
  logger = console,
  now = Date.now,
} = {}) {
  if (!channel || typeof channel !== 'object') {
    throw new TypeError('Lark webhook server requires a channel object.');
  }
  if (channel[WEBHOOK_EXTENSION_MARK]) return channel;
  if (typeof channel?.dispatcher?.invoke !== 'function') {
    throw new TypeError('Lark webhook channel does not expose dispatcher.invoke().');
  }
  if (typeof channel.connect !== 'function' || typeof channel.disconnect !== 'function') {
    throw new TypeError('Lark webhook channel requires connect() and disconnect().');
  }

  const webhookHost = String(host || '127.0.0.1').trim() || '127.0.0.1';
  const webhookPort = Math.max(0, Math.min(65535, Number(port) || 0));
  const webhookPath = normalizeWebhookPath(path);
  const webhookHealthPath = normalizeWebhookPath(healthPath || '/healthz');
  if (webhookHealthPath === webhookPath) {
    throw new TypeError('Lark webhook health path must differ from the callback path.');
  }
  const bodyLimit = Math.max(1024, Number(maxBodyBytes) || 1024 * 1024);
  const headerTimeout = Math.max(1000, Number(headersTimeoutMs) || 10_000);
  const requestTimeout = Math.max(headerTimeout, Number(requestTimeoutMs) || 15_000);
  const keepAliveTimeout = Math.max(1000, Number(keepAliveTimeoutMs) || 5000);
  const baseConnect = channel.connect.bind(channel);
  const baseDisconnect = channel.disconnect.bind(channel);
  if (typeof channel.updateCard === 'function') {
    const baseUpdateCard = channel.updateCard.bind(channel);
    channel.updateCard = async (messageId, card) => {
      const callbackContext = LEGACY_CARD_CALLBACK_CONTEXT.getStore();
      const normalizedMessageId = String(messageId || '').trim();
      if (callbackContext?.channel === channel
        && normalizedMessageId
        && normalizedMessageId === callbackContext.messageId) {
        callbackContext.responseCard = card;
        callbackContext.deferredCardUpdates.push({
          messageId: normalizedMessageId,
          run: () => baseUpdateCard(messageId, card),
        });
        return undefined;
      }
      return baseUpdateCard(messageId, card);
    };
  }
  let server = null;
  let connectPromise = null;
  let state = 'idle';
  let lastConnectTime = null;
  let lastError = null;
  let boundPort = webhookPort;

  async function recordVerifiedRequest(body, {
    challenge = false,
    signatureVerified = false,
  } = {}) {
    try {
      await onVerifiedRequest({
        challenge,
        encrypted: Boolean(String(body?.encrypt || '').trim()),
        signed: signatureVerified === true,
      });
    } catch {
      logger.warn?.('[webhook-acceptance-receipt] platform=lark status=failed');
    }
  }

  async function handleRequest(request, response) {
    let pathname = '';
    let requestEnvelope = null;
    try {
      pathname = new URL(request.url || '/', 'http://lark-webhook.local').pathname;
    } catch {
      sendJson(response, 400, { ok: false, error: 'invalid request URL' });
      return;
    }
    if (pathname === webhookHealthPath) {
      if (request.method !== 'GET') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      const connected = state === 'connected' && Boolean(server?.listening);
      sendJson(response, connected ? 200 : 503, {
        ok: connected,
        platform: 'lark',
        transport: 'webhook',
        state,
      });
      return;
    }
    if (pathname !== webhookPath) {
      sendJson(response, 404, { ok: false, error: 'not found' });
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > bodyLimit) {
      request.resume();
      sendJson(response, 413, { ok: false, error: 'payload too large' });
      return;
    }
    try {
      const body = await readJsonBody(request, bodyLimit);
      const data = { ...body };
      Object.defineProperty(data, 'headers', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: request.headers,
      });
      requestEnvelope = data;
      if (typeof generateChallenge === 'function') {
        const challenge = generateChallenge(body, {
          encryptKey: channel.dispatcher.encryptKey,
        });
        if (challenge?.isChallenge) {
          const verification = validateRequestEnvelope(channel.dispatcher, data, {
            allowUnsigned: true,
          });
          await recordVerifiedRequest(body, {
            challenge: true,
            signatureVerified: verification.signatureVerified,
          });
          sendJson(response, 200, challenge.challenge);
          return;
        }
      }
      const legacyCardAction = isLegacyCardActionEnvelope(data);
      const verification = validateRequestEnvelope(channel.dispatcher, data, {
        cardAction: legacyCardAction,
      });
      const directCardAction = verification.cardAction && !verification.parsed?.schema;
      const dispatchedCardAction = directCardAction
        ? await dispatchLegacyCardAction(channel, verification.parsed, { headers: request.headers })
        : null;
      const result = directCardAction
        ? dispatchedCardAction.result
        : await channel.dispatcher.invoke(data, { needCheck: false });
      await recordVerifiedRequest(body, {
        signatureVerified: verification.signatureVerified,
      });
      scheduleDeferredCardUpdates(response, dispatchedCardAction?.deferredCardUpdates, logger);
      sendJson(response, 200, result ?? {});
    } catch (error) {
      const tooLarge = error?.code === 'payload_too_large';
      logger.warn?.(formatRejectionLog(error));
      if (error?.code === 'verification_failed' && requestEnvelope) {
        const stage = String(error?.verificationStage || 'unknown').replace(/[^a-z_-]/gi, '').slice(0, 24);
        const method = String(error?.verificationMethod || 'unknown').replace(/[^a-z_-]/gi, '').slice(0, 24);
        logger.debug?.(`[lark-webhook-verification] stage=${stage} method=${method} ${formatEnvelopeShape(requestEnvelope)}`);
      }
      sendJson(response, tooLarge ? 413 : 400, {
        ok: false,
        error: tooLarge ? 'payload too large' : 'invalid webhook request',
      });
    }
  }

  async function connect() {
    if (state === 'connected' && server?.listening) return channel;
    if (connectPromise) return connectPromise;
    connectPromise = (async () => {
      state = 'connecting';
      lastConnectTime = Number(now()) || Date.now();
      lastError = null;
      try {
        await baseConnect();
        server = createServer((request, response) => {
          void handleRequest(request, response);
        });
        server.headersTimeout = headerTimeout;
        server.requestTimeout = requestTimeout;
        server.keepAliveTimeout = keepAliveTimeout;
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server?.off?.('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            server?.off?.('error', onError);
            resolve();
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(webhookPort, webhookHost);
        });
        const address = server.address();
        if (address && typeof address === 'object') boundPort = address.port;
        state = 'connected';
        logger.log?.(`✅ Lark webhook listening on http://${webhookHost}:${boundPort}${webhookPath}; health http://${webhookHost}:${boundPort}${webhookHealthPath}`);
        return channel;
      } catch (error) {
        lastError = String(error?.message || error || 'webhook start failed');
        state = 'failed';
        await closeServer(server);
        server = null;
        await Promise.resolve(baseDisconnect()).catch(() => {});
        throw error;
      }
    })();
    try {
      return await connectPromise;
    } finally {
      connectPromise = null;
    }
  }

  async function disconnect() {
    await closeServer(server);
    server = null;
    await baseDisconnect();
    state = 'idle';
  }

  function getConnectionStatus() {
    return {
      state,
      lastConnectTime: lastConnectTime || undefined,
      reconnectAttempts: 0,
      endpoint: {
        host: webhookHost,
        port: boundPort,
        path: webhookPath,
        healthPath: webhookHealthPath,
        headersTimeoutMs: headerTimeout,
        requestTimeoutMs: requestTimeout,
        keepAliveTimeoutMs: keepAliveTimeout,
      },
      lastError,
    };
  }

  channel.connect = connect;
  channel.disconnect = disconnect;
  channel.getConnectionStatus = getConnectionStatus;
  Object.defineProperty(channel, WEBHOOK_EXTENSION_MARK, {
    value: true,
    enumerable: false,
  });
  return channel;
}
