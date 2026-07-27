import { execFile as execFileCallback, spawn as spawnProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { normalizeLarkBotMenuEvent } from './platforms/lark/bot-menu.js';

const execFileAsync = promisify(execFileCallback);
const EVENT_KEYS = Object.freeze([
  'im.message.receive_v1',
  'card.action.trigger',
  'application.bot.menu_v6',
]);
const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;
const RESOURCE_CACHE_LIMIT = 1000;

function normalizeId(value) {
  return String(value || '').trim() || null;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveMentionOpenId(mention) {
  return normalizeId(
    mention?.openId
    || mention?.open_id
    || mention?.id?.open_id
    || mention?.id,
  );
}

export function stripLarkCliBotMentions(content, mentions, botOpenId) {
  const botId = normalizeId(botOpenId);
  let result = String(content || '');
  if (!botId) return result;

  const botMentions = (Array.isArray(mentions) ? mentions : [])
    .filter((mention) => resolveMentionOpenId(mention) === botId);
  if (!botMentions.length) return result;

  const escapedBotId = escapeRegex(botId);
  result = result.replace(
    new RegExp(`<at\\b[^>]*(?:user_id|id)=["']?${escapedBotId}["']?[^>]*>[\\s\\S]*?<\\/at>`, 'gi'),
    ' ',
  );
  for (const mention of botMentions) {
    const tokens = [
      mention?.key,
      mention?.name ? `@${mention.name}` : null,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    for (const token of tokens) {
      result = result.replace(new RegExp(`\\s?${escapeRegex(token)}\\s?`, 'g'), ' ');
    }
  }
  return result.replace(/[ \t]{2,}/g, ' ').trim();
}

function parseJsonLine(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonOutput(value) {
  const parsed = parseJsonLine(value);
  if (parsed) return parsed;
  const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = parseJsonLine(lines[index]);
    if (candidate) return candidate;
  }
  throw new Error('lark-cli returned invalid JSON.');
}

function cliProblemFrom(error) {
  const payload = parseJsonLine(error?.stderr);
  return payload?.error && typeof payload.error === 'object' ? payload.error : null;
}

function toCliError(error, action) {
  const problem = cliProblemFrom(error);
  const message = String(problem?.message || error?.message || `lark-cli ${action} failed`).trim();
  const hint = String(problem?.hint || '').trim();
  const wrapped = new Error(hint ? `${message}; ${hint}` : message, { cause: error });
  wrapped.code = String(problem?.subtype || problem?.type || error?.code || 'lark_cli_error');
  wrapped.fatal = ['authentication', 'authorization', 'config', 'validation'].includes(String(problem?.type || ''))
    || wrapped.code === 'ENOENT';
  return wrapped;
}

function decodeAttribute(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractAttribute(source, name) {
  const match = String(source || '').match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? decodeAttribute(match[1]) : '';
}

export function extractLarkCliResources(content) {
  const text = String(content || '');
  const resources = [];
  const seen = new Set();
  const add = (fileKey, type, fileName = '') => {
    const key = normalizeId(fileKey);
    if (!key || seen.has(key)) return;
    seen.add(key);
    resources.push({
      fileKey: key,
      type: type === 'image' ? 'image' : 'file',
      fileName: String(fileName || '').trim() || undefined,
    });
  };

  for (const match of text.matchAll(/\[Image:\s*([^\]]+)\]/gi)) add(match[1], 'image');
  for (const match of text.matchAll(/!\[Image\]\((img_[^)]+)\)/gi)) add(match[1], 'image');
  for (const match of text.matchAll(/\[Media:\s*([^\]]+)\]/gi)) add(match[1], 'file');
  for (const match of text.matchAll(/<(file|audio|video|media)\b([^>]*)\/?\s*>/gi)) {
    add(extractAttribute(match[2], 'key'), 'file', extractAttribute(match[2], 'name'));
  }

  return resources;
}

export function normalizeLarkCliMessageEvent(event, { botOpenId = null } = {}) {
  const messageId = normalizeId(event?.message_id || event?.id);
  const chatId = normalizeId(event?.chat_id);
  const senderId = normalizeId(event?.sender_id);
  if (!messageId || !chatId || !senderId) {
    throw new TypeError('lark-cli message event requires message_id, chat_id, and sender_id.');
  }
  const mentions = Array.isArray(event?.mentions) ? event.mentions : [];
  const resources = extractLarkCliResources(event?.content);
  const content = stripLarkCliBotMentions(event?.content, mentions, botOpenId);
  return {
    messageId,
    chatId,
    chatType: String(event?.chat_type || 'group').trim().toLowerCase() || 'group',
    senderId,
    senderName: String(event?.sender_name || senderId),
    content,
    rootId: normalizeId(event?.root_id),
    threadId: normalizeId(event?.thread_id),
    replyToMessageId: normalizeId(event?.reply_to),
    mentionedBot: Boolean(botOpenId && mentions.some((mention) => (
      resolveMentionOpenId(mention) === normalizeId(botOpenId)
    ))),
    resources,
    raw: {
      ...event,
      senderType: String(event?.sender_type || '').trim().toLowerCase(),
    },
  };
}

function parseJsonValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const parsed = parseJsonLine(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

export function normalizeLarkCliCardActionEvent(event) {
  const messageId = normalizeId(event?.message_id);
  const chatId = normalizeId(event?.chat_id);
  const operatorId = normalizeId(event?.operator_id);
  if (!messageId || !chatId || !operatorId) {
    throw new TypeError('lark-cli card action requires message_id, chat_id, and operator_id.');
  }
  const value = parseJsonValue(event?.action_value);
  const options = String(event?.options || '').split(',').map((item) => item.trim()).filter(Boolean);
  const hasFormValue = event?.form_value && (
    typeof event.form_value === 'object' || String(event.form_value).trim()
  );
  return {
    id: normalizeId(event?.event_id) || `${messageId}:${operatorId}`,
    messageId,
    chatId,
    rootId: normalizeId(event?.root_id),
    threadId: normalizeId(event?.thread_id),
    tenantId: normalizeId(event?.tenant_key),
    operator: {
      openId: operatorId,
      name: String(event?.operator_name || operatorId),
    },
    action: {
      value,
      tag: String(event?.action_tag || 'unknown'),
      name: normalizeId(event?.action_name),
      option: normalizeId(event?.option),
      options,
      ...(hasFormValue ? { formValue: parseJsonValue(event.form_value) } : {}),
    },
    token: normalizeId(event?.token),
    raw: event,
  };
}

function resolveLarkCliMessageContext(result) {
  const items = Array.isArray(result?.data?.items) ? result.data.items : [];
  const item = items[0] || result?.data || result || {};
  return {
    chatId: normalizeId(item?.chat_id),
    rootId: normalizeId(item?.root_id),
    threadId: normalizeId(item?.thread_id),
  };
}

function processExitPromise(child) {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

export function createLarkCliChannel({
  cliBin = 'lark-cli',
  profile = '',
  cwd = process.cwd(),
  env = process.env,
  logger = console,
  handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
  execFileFn = execFileAsync,
  spawnFn = spawnProcess,
  now = Date.now,
} = {}) {
  const emitter = new EventEmitter();
  const resourceMessages = new Map();
  const reactionIds = new Map();
  const consumers = new Map();
  const reconnectingConsumers = new Set();
  let connectPromise = null;
  let ready = false;
  let disconnecting = false;
  let reconnecting = false;
  let lastConnectTime = null;
  let reconnectAttempts = 0;
  let totalReconnects = 0;
  let terminalError = null;

  const cliEnv = {
    ...env,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
  };

  function withProfile(args) {
    const normalized = String(profile || '').trim();
    return normalized ? ['--profile', normalized, ...args] : args;
  }

  async function runCliJson(args, options = {}) {
    try {
      const result = await execFileFn(cliBin, withProfile(args), {
        cwd: options.cwd || cwd,
        env: cliEnv,
        maxBuffer: DEFAULT_MAX_BUFFER,
      });
      return parseJsonOutput(result?.stdout);
    } catch (error) {
      throw toCliError(error, args.slice(0, 2).join(' '));
    }
  }

  function rememberResources(message) {
    for (const resource of message.resources || []) {
      resourceMessages.delete(resource.fileKey);
      resourceMessages.set(resource.fileKey, {
        messageId: message.messageId,
        type: resource.type,
      });
    }
    while (resourceMessages.size > RESOURCE_CACHE_LIMIT) {
      resourceMessages.delete(resourceMessages.keys().next().value);
    }
  }

  async function resolveBotIdentity() {
    const status = await runCliJson(['auth', 'status', '--verify', '--json']);
    const bot = status?.identities?.bot;
    const openId = normalizeId(bot?.openId || bot?.open_id);
    if (!bot?.available || String(bot?.status || '').trim().toLowerCase() !== 'ready' || !openId) {
      const error = new Error('lark-cli bot identity is unavailable; run `lark-cli auth status --verify --json`.');
      error.code = 'permission_denied';
      error.fatal = true;
      throw error;
    }
    channel.botIdentity = {
      openId,
      appName: String(bot.appName || '').trim() || null,
    };
  }

  async function enrichCardActionContext(action) {
    if (action?.rootId || action?.threadId) return action;
    try {
      const result = await runCliJson([
        'api',
        'GET',
        `/open-apis/im/v1/messages/${encodeURIComponent(String(action?.messageId || ''))}`,
        '--as',
        'bot',
      ]);
      const context = resolveLarkCliMessageContext(result);
      return {
        ...action,
        chatId: action?.chatId || context.chatId,
        rootId: context.rootId,
        threadId: context.threadId,
      };
    } catch (error) {
      logger.warn?.(`Unable to resolve lark-cli card reply-chain context: ${error.message}`);
      return action;
    }
  }

  function startConsumer(eventKey) {
    return new Promise((resolve, reject) => {
      const child = spawnFn(cliBin, withProfile([
        'event',
        'consume',
        eventKey,
        '--as',
        'bot',
      ]), {
        cwd,
        env: cliEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      consumers.set(eventKey, child);
      disconnecting = false;
      let settled = false;

      const stdoutLines = readline.createInterface({ input: child.stdout });
      const stderrLines = readline.createInterface({ input: child.stderr });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        const error = new Error(`lark-cli ${eventKey} handshake timed out after ${handshakeTimeoutMs}ms.`);
        error.code = 'handshake_timeout';
        reject(error);
      }, Math.max(1000, Number(handshakeTimeoutMs) || DEFAULT_HANDSHAKE_TIMEOUT_MS));
      timeout.unref?.();

      function markReady() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(child);
      }

      stdoutLines.on('line', async (line) => {
        const parsed = parseJsonLine(line);
        if (!parsed) {
          logger.warn?.(`Ignoring malformed lark-cli event output: ${String(line).slice(0, 200)}`);
          return;
        }
        try {
          if (eventKey === 'im.message.receive_v1') {
            const message = normalizeLarkCliMessageEvent(parsed, {
              botOpenId: channel.botIdentity?.openId,
            });
            rememberResources(message);
            emitter.emit('message', message);
          } else if (eventKey === 'card.action.trigger') {
            const action = normalizeLarkCliCardActionEvent(parsed);
            emitter.emit('cardAction', await enrichCardActionContext(action));
          } else if (eventKey === 'application.bot.menu_v6') {
            emitter.emit('botMenu', normalizeLarkBotMenuEvent(parsed));
          }
        } catch (error) {
          logger.warn?.(`Ignoring unsupported lark-cli event: ${error.message}`);
        }
      });

      stderrLines.on('line', (line) => {
        const text = String(line || '').trim();
        if (text === `[event] ready event_key=${eventKey}`) {
          markReady();
          return;
        }
        if (/\[source\].*reconnecting/i.test(text) || /\[source\].*disconnected/i.test(text)) {
          if (reconnectingConsumers.size === 0) {
            reconnectAttempts += 1;
            totalReconnects += 1;
          }
          reconnectingConsumers.add(eventKey);
          reconnecting = true;
          emitter.emit('reconnecting');
          return;
        }
        if (/\[source\].*connected/i.test(text) && reconnectingConsumers.has(eventKey)) {
          reconnectingConsumers.delete(eventKey);
          if (reconnectingConsumers.size === 0) {
            reconnecting = false;
            reconnectAttempts = 0;
            emitter.emit('reconnected');
          }
        }
      });

      child.once('error', (error) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          terminalError = toCliError(error, `event consume ${eventKey}`);
          reject(terminalError);
          return;
        }
        if (!disconnecting) {
          terminalError = toCliError(error, `event consume ${eventKey}`);
          emitter.emit('error', terminalError);
        }
      });

      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        stdoutLines.close();
        stderrLines.close();
        consumers.delete(eventKey);
        reconnectingConsumers.delete(eventKey);
        ready = false;
        const expected = disconnecting;
        if (!settled) {
          settled = true;
          const error = new Error(`lark-cli ${eventKey} consumer exited before ready (code=${code}, signal=${signal || 'none'}).`);
          error.code = 'not_connected';
          terminalError = error;
          reject(error);
        } else if (!expected) {
          const error = new Error(`lark-cli ${eventKey} consumer exited (code=${code}, signal=${signal || 'none'}).`);
          error.code = 'not_connected';
          terminalError = error;
          emitter.emit('error', error);
        }
      });
    });
  }

  async function connect() {
    if (ready && consumers.size === EVENT_KEYS.length) return channel;
    if (connectPromise) return connectPromise;
    lastConnectTime = Number(now()) || Date.now();
    terminalError = null;
    connectPromise = (async () => {
      await resolveBotIdentity();
      try {
        await Promise.all(EVENT_KEYS.map(startConsumer));
        ready = true;
        terminalError = null;
        return channel;
      } catch (error) {
        terminalError = error;
        await disconnect();
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
    if (!consumers.size) {
      ready = false;
      return;
    }
    disconnecting = true;
    const children = [...consumers.values()];
    await Promise.all(children.map(async (child) => {
      const exited = processExitPromise(child);
      child.kill('SIGTERM');
      await Promise.race([
        exited,
        new Promise((resolve) => {
          const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 5000);
          timeout.unref?.();
        }),
      ]);
    }));
    consumers.clear();
    reconnectingConsumers.clear();
    disconnecting = false;
    reconnecting = false;
    reconnectAttempts = 0;
    ready = false;
  }

  function getConnectionStatus() {
    let state = 'idle';
    if (terminalError) state = 'failed';
    else if (reconnecting) state = 'reconnecting';
    else if (ready && consumers.size === EVENT_KEYS.length) state = 'connected';
    else if (connectPromise) state = 'connecting';
    return {
      state,
      lastConnectTime: lastConnectTime || undefined,
      reconnectAttempts,
      totalReconnects,
      consumerCount: consumers.size,
      expectedConsumerCount: EVENT_KEYS.length,
    };
  }

  async function send(chatId, input, options = {}) {
    const card = input?.card && typeof input.card === 'object' ? input.card : null;
    const text = String(input?.text || input?.content || '');
    const replyTo = normalizeId(options.replyTo);
    const receiveId = String(chatId || '').trim();
    const isUserTarget = /^ou_/i.test(receiveId);
    const args = replyTo
      ? ['im', '+messages-reply', '--as', 'bot', '--message-id', replyTo]
      : ['im', '+messages-send', '--as', 'bot', isUserTarget ? '--user-id' : '--chat-id', receiveId];
    if (card) args.push('--msg-type', 'interactive', '--content', JSON.stringify(card));
    else args.push('--text', text);
    if (replyTo && options.replyInThread) args.push('--reply-in-thread');
    const result = await runCliJson(args);
    return {
      messageId: normalizeId(result?.data?.message_id || result?.message_id),
      chatId: normalizeId(result?.data?.chat_id || result?.chat_id || (isUserTarget ? null : chatId)),
      raw: result,
    };
  }

  async function editMessage(messageId, text) {
    const data = JSON.stringify({
      msg_type: 'text',
      content: JSON.stringify({ text: String(text || '') }),
    });
    return runCliJson([
      'api',
      'PATCH',
      `/open-apis/im/v1/messages/${encodeURIComponent(String(messageId || ''))}`,
      '--as',
      'bot',
      '--data',
      data,
    ]);
  }

  async function updateCard(messageId, card) {
    return runCliJson([
      'api',
      'PATCH',
      `/open-apis/im/v1/messages/${encodeURIComponent(String(messageId || ''))}`,
      '--as',
      'bot',
      '--data',
      JSON.stringify({ content: JSON.stringify(card || {}) }),
    ]);
  }

  async function recallMessage(messageId) {
    return runCliJson([
      'api',
      'DELETE',
      `/open-apis/im/v1/messages/${encodeURIComponent(String(messageId || ''))}`,
      '--as',
      'bot',
    ]);
  }

  async function listMessages({ containerIdType = 'chat', containerId, limit = 25 } = {}) {
    const type = containerIdType === 'thread' ? 'thread' : 'chat';
    const id = normalizeId(containerId);
    if (!id) throw new TypeError('lark-cli message listing requires containerId.');
    const result = await runCliJson([
      'api',
      'GET',
      '/open-apis/im/v1/messages',
      '--as',
      'bot',
      '--params',
      JSON.stringify({
        container_id_type: type,
        container_id: id,
        page_size: Math.max(1, Math.min(50, Number(limit) || 25)),
        sort_type: 'ByCreateTimeDesc',
      }),
    ]);
    return Array.isArray(result?.data?.items) ? result.data.items : [];
  }

  async function addReaction(messageId, emojiType) {
    const normalizedMessageId = String(messageId || '').trim();
    const normalizedEmoji = String(emojiType || '').trim();
    const result = await runCliJson([
      'api',
      'POST',
      `/open-apis/im/v1/messages/${encodeURIComponent(normalizedMessageId)}/reactions`,
      '--as',
      'bot',
      '--data',
      JSON.stringify({ reaction_type: { emoji_type: normalizedEmoji } }),
    ]);
    const reactionId = normalizeId(result?.data?.reaction_id || result?.reaction_id);
    if (reactionId) reactionIds.set(`${normalizedMessageId}:${normalizedEmoji}`, reactionId);
    return reactionId;
  }

  async function removeReactionByEmoji(messageId, emojiType) {
    const normalizedMessageId = String(messageId || '').trim();
    const normalizedEmoji = String(emojiType || '').trim();
    const key = `${normalizedMessageId}:${normalizedEmoji}`;
    const reactionId = reactionIds.get(key);
    if (!reactionId) return false;
    await runCliJson([
      'api',
      'DELETE',
      `/open-apis/im/v1/messages/${encodeURIComponent(normalizedMessageId)}/reactions/${encodeURIComponent(reactionId)}`,
      '--as',
      'bot',
    ]);
    reactionIds.delete(key);
    return true;
  }

  async function downloadResource(fileKey, type = 'file') {
    const key = normalizeId(fileKey);
    const cached = key ? resourceMessages.get(key) : null;
    if (!key || !cached?.messageId) {
      throw new Error(`No lark-cli message mapping is available for resource ${key || '(empty)'}.`);
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aid-lark-cli-resource-'));
    try {
      const result = await runCliJson([
        'im',
        '+messages-resources-download',
        '--as',
        'bot',
        '--message-id',
        cached.messageId,
        '--file-key',
        key,
        '--type',
        type === 'image' ? 'image' : 'file',
        '--output',
        'resource',
      ], { cwd: tempDir });
      const savedPath = String(result?.data?.saved_path || result?.saved_path || '').trim();
      if (!savedPath) throw new Error('lark-cli resource download did not return saved_path.');
      const resolved = path.resolve(tempDir, savedPath);
      if (resolved !== tempDir && !resolved.startsWith(`${tempDir}${path.sep}`)) {
        throw new Error('lark-cli resource download returned an unsafe path.');
      }
      return await fs.readFile(resolved);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  const channel = Object.assign(emitter, {
    botIdentity: { openId: null, appName: null },
    connect,
    disconnect,
    getConnectionStatus,
    send,
    editMessage,
    updateCard,
    recallMessage,
    listMessages,
    addReaction,
    removeReactionByEmoji,
    downloadResource,
  });
  return channel;
}
