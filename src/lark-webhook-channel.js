import http from 'node:http';

const WEBHOOK_EXTENSION_MARK = Symbol.for('agents-in-discord.lark-webhook');

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

function validateRequestEnvelope(dispatcher, data) {
  const requestHandle = dispatcher?.requestHandle;
  let signatureVerified = false;
  if (typeof requestHandle?.checkIsEventValidated === 'function'
    && !requestHandle.checkIsEventValidated(data)) {
    const error = new Error('Lark webhook signature verification failed.');
    error.code = 'verification_failed';
    throw error;
  }
  if (typeof requestHandle?.checkIsEventValidated === 'function') {
    signatureVerified = Boolean(String(data?.headers?.['x-lark-signature'] || '').trim());
  }
  const verificationToken = String(dispatcher?.verificationToken || '').trim();
  if (!verificationToken || typeof requestHandle?.parse !== 'function') {
    return { signatureVerified };
  }
  const parsed = requestHandle.parse(data);
  const receivedToken = String(parsed?.token || parsed?.verification_token || '').trim();
  if (receivedToken !== verificationToken) {
    const error = new Error('Lark webhook verification token mismatch.');
    error.code = 'verification_failed';
    throw error;
  }
  return { signatureVerified };
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
      const verification = validateRequestEnvelope(channel.dispatcher, data);
      if (typeof generateChallenge === 'function') {
        const challenge = generateChallenge(body, {
          encryptKey: channel.dispatcher.encryptKey,
        });
        if (challenge?.isChallenge) {
          await recordVerifiedRequest(body, {
            challenge: true,
            signatureVerified: verification.signatureVerified,
          });
          sendJson(response, 200, challenge.challenge);
          return;
        }
      }
      const result = await channel.dispatcher.invoke(data, { needCheck: false });
      await recordVerifiedRequest(body, {
        signatureVerified: verification.signatureVerified,
      });
      sendJson(response, 200, result ?? {});
    } catch (error) {
      const tooLarge = error?.code === 'payload_too_large';
      logger.warn?.(formatRejectionLog(error));
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
