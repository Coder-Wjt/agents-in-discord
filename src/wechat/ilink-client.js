import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';

import { fetchWechat } from './http.js';
import { atomicWrite, readJson, writeJson } from './storage.js';

const CHANNEL_VERSION = '1.0.2';
const DEFAULT_LONG_POLL_MS = 45_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateWechatUin() {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), 'utf8').toString('base64');
}

export function splitWechatText(text, maxLength = 2000) {
  const chunks = [];
  let remaining = String(text || '');
  while (remaining.length > maxLength) {
    let index = remaining.lastIndexOf('\n\n', maxLength);
    if (index < maxLength * 0.3) index = remaining.lastIndexOf('\n', maxLength);
    if (index < maxLength * 0.3) index = remaining.lastIndexOf(' ', maxLength);
    if (index < maxLength * 0.3) index = maxLength;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function parseWechatMessage(message) {
  const parts = [];
  let quotedText = '';
  let unsupportedMedia = 0;
  for (const item of message?.item_list || []) {
    if (item?.type === 1 && item.text_item?.text) {
      parts.push(item.text_item.text);
    } else if (item?.type === 3 && item.voice_item?.text) {
      parts.push(item.voice_item.text);
    } else if ([2, 4, 5].includes(item?.type)) {
      unsupportedMedia += 1;
    }

    const ref = item?.ref_msg;
    if (ref?.message_item?.text_item?.text) {
      quotedText = ref.message_item.text_item.text;
    } else if (ref?.message_item?.voice_item?.text) {
      quotedText = ref.message_item.voice_item.text;
    } else if (ref?.title) {
      quotedText = ref.title;
    }
  }
  return {
    text: parts.join('\n').trim().replace(/^\[引用\]:\n?/, ''),
    quotedText,
    unsupportedMedia,
  };
}

export class WechatILinkClient {
  constructor({
    credentials,
    pollCursorFile,
    contextTokensFile,
    logger = console,
  } = {}) {
    this.credentials = credentials;
    this.pollCursorFile = pollCursorFile;
    this.contextTokensFile = contextTokensFile;
    this.logger = logger;
    this.pollCursor = '';
    try {
      this.pollCursor = String(pollCursorFile ? fs.readFileSync(pollCursorFile, 'utf8') : '').trim();
    } catch {
    }
    const savedTokens = readJson(contextTokensFile, {});
    this.contextTokens = new Map(Object.entries(savedTokens || {}));
    this.handlers = [];
    this.seen = new Set();
    this.seenOrder = [];
    this.sendQueues = new Map();
    this.typingTickets = new Map();
    this.running = false;
    this.abortController = null;
    this.longPollMs = DEFAULT_LONG_POLL_MS;
    this.reloginHandler = null;
  }

  headers() {
    return {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      Authorization: `Bearer ${this.credentials.botToken}`,
      'X-WECHAT-UIN': generateWechatUin(),
    };
  }

  baseInfo() {
    return { channel_version: CHANNEL_VERSION };
  }

  onMessage(handler) {
    this.handlers.push(handler);
  }

  setReloginHandler(handler) {
    this.reloginHandler = handler;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.pollLoop();
  }

  stop() {
    this.running = false;
    this.abortController?.abort();
  }

  isFresh(userId, messageId) {
    const key = `${userId}:${messageId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > 1000) {
      const evicted = this.seenOrder.shift();
      if (evicted) this.seen.delete(evicted);
    }
    return true;
  }

  async pollLoop() {
    let backoffMs = 1000;
    while (this.running) {
      try {
        const messages = await this.getUpdates();
        backoffMs = 1000;
        for (const message of messages) {
          await this.processMessage(message);
        }
      } catch (err) {
        if (!this.running) return;
        if (err?.name === 'AbortError') continue;
        if ((err?.errcode === -14 || err?.errcode === -13) && this.reloginHandler) {
          try {
            this.credentials = await this.reloginHandler();
            continue;
          } catch (loginErr) {
            this.logger.error(`[wechat] relogin failed: ${loginErr?.message || loginErr}`);
          }
        } else {
          this.logger.error(`[wechat] poll failed: ${err?.message || err}`);
        }
        await sleep(Math.floor(backoffMs * (0.5 + Math.random() * 0.5)));
        backoffMs = Math.min(30_000, backoffMs * 2);
      }
    }
  }

  async getUpdates() {
    this.abortController = new AbortController();
    const timer = setTimeout(() => this.abortController?.abort(), this.longPollMs);
    try {
      const response = await fetchWechat(
        `${this.credentials.baseUrl}/ilink/bot/getupdates`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            get_updates_buf: this.pollCursor,
            base_info: this.baseInfo(),
          }),
          signal: this.abortController.signal,
          timeoutMs: this.longPollMs + 15_000,
          retries: 2,
          retryOnHttpError: true,
        },
      );
      if (!response.ok) throw new Error(`WeChat getupdates failed: HTTP ${response.status}`);
      const data = await response.json();
      if (data.ret !== undefined && data.ret !== 0) {
        const error = new Error(data.errmsg || `ret=${data.ret}`);
        error.errcode = data.errcode;
        throw error;
      }
      if (Number.isFinite(data.longpolling_timeout_ms) && data.longpolling_timeout_ms > 0) {
        this.longPollMs = Math.min(120_000, Math.max(10_000, data.longpolling_timeout_ms + 5000));
      }
      if (data.get_updates_buf) {
        this.pollCursor = data.get_updates_buf;
        atomicWrite(this.pollCursorFile, this.pollCursor);
      }
      return data.msgs || [];
    } finally {
      clearTimeout(timer);
    }
  }

  async processMessage(message) {
    if (message?.message_type !== 1) return;
    if (!this.isFresh(message.from_user_id, message.message_id)) return;
    this.contextTokens.set(message.from_user_id, message.context_token);
    writeJson(this.contextTokensFile, Object.fromEntries(this.contextTokens));
    const parsed = parseWechatMessage(message);
    if (!parsed.text && !parsed.quotedText && parsed.unsupportedMedia === 0) return;
    for (const handler of this.handlers) {
      try {
        Promise.resolve(handler(message, parsed)).catch((err) => {
          this.logger.error(`[wechat] message handler failed: ${err?.message || err}`);
        });
      } catch (err) {
        this.logger.error(`[wechat] message handler failed: ${err?.message || err}`);
      }
    }
  }

  async sendText(userId, text) {
    const contextToken = this.contextTokens.get(userId);
    if (!contextToken) throw new Error('WeChat context token unavailable; send the bot a message first');
    const previous = this.sendQueues.get(userId) || Promise.resolve();
    const run = previous.then(async () => {
      for (const chunk of splitWechatText(text)) {
        await this.sendRawText(userId, contextToken, chunk);
      }
    });
    const tracked = run.catch(() => {});
    this.sendQueues.set(userId, tracked);
    return run.finally(() => {
      if (this.sendQueues.get(userId) === tracked) this.sendQueues.delete(userId);
    });
  }

  async sendRawText(userId, contextToken, text) {
    const response = await fetchWechat(
      `${this.credentials.baseUrl}/ilink/bot/sendmessage`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          msg: {
            from_user_id: '',
            to_user_id: userId,
            client_id: randomUUID(),
            message_type: 2,
            message_state: 2,
            context_token: contextToken,
            item_list: [{ type: 1, text_item: { text } }],
          },
          base_info: this.baseInfo(),
        }),
        timeoutMs: 30_000,
        retries: 2,
      },
    );
    if (!response.ok) throw new Error(`WeChat send failed: HTTP ${response.status}`);
    const data = await response.json();
    if (data.ret !== undefined && data.ret !== 0) {
      throw new Error(data.errmsg || `WeChat send failed: ret=${data.ret}`);
    }
  }

  async startTyping(userId) {
    const contextToken = this.contextTokens.get(userId);
    if (!contextToken) return () => {};
    try {
      const ticket = await this.getTypingTicket(userId, contextToken);
      if (!ticket) return () => {};
      await this.sendTyping(userId, ticket, 1);
      const timer = setInterval(() => {
        void this.sendTyping(userId, ticket, 1).catch(() => {});
      }, 5000);
      return () => {
        clearInterval(timer);
        void this.sendTyping(userId, ticket, 2).catch(() => {});
      };
    } catch {
      return () => {};
    }
  }

  async getTypingTicket(userId, contextToken) {
    const cached = this.typingTickets.get(userId);
    if (cached && Date.now() - cached.savedAt < 20 * 60 * 60_000) return cached.ticket;
    const response = await fetchWechat(
      `${this.credentials.baseUrl}/ilink/bot/getconfig`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          ilink_user_id: userId,
          context_token: contextToken,
          base_info: this.baseInfo(),
        }),
        timeoutMs: 15_000,
        retries: 1,
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data.ret !== 0 || !data.typing_ticket) return null;
    this.typingTickets.set(userId, { ticket: data.typing_ticket, savedAt: Date.now() });
    return data.typing_ticket;
  }

  async sendTyping(userId, ticket, status) {
    await fetchWechat(
      `${this.credentials.baseUrl}/ilink/bot/sendtyping`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          ilink_user_id: userId,
          typing_ticket: ticket,
          status,
          base_info: this.baseInfo(),
        }),
        timeoutMs: 10_000,
        retries: 0,
      },
    );
  }
}
