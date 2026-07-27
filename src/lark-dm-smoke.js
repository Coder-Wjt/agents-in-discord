export const LARK_USER_SEND_SCOPE = 'im:message.send_as_user';

const SAFE_ERROR_MESSAGES = Object.freeze({
  lark_dm_smoke_cli_error: 'lark-cli operation failed.',
  lark_dm_smoke_cli_unavailable: 'lark-cli is unavailable.',
  lark_dm_smoke_native_command_unavailable: 'Native profile command is unavailable.',
  lark_dm_smoke_send_invalid: 'Lark DM smoke send returned an invalid response.',
  lark_dm_smoke_timeout: 'Lark DM smoke timed out.',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePositiveInteger(value, fallback, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed || fallback;
}

function normalizeScopes(value) {
  const values = Array.isArray(value) ? value : normalizeText(value).split(/\s+/);
  return new Set(values.map(normalizeText).filter(Boolean));
}

function normalizeSenderType(message) {
  return normalizeText(message?.sender?.sender_type || message?.sender_type).toLowerCase();
}

function messageContains(message, marker) {
  const expected = normalizeText(marker);
  if (!expected) return true;
  return normalizeText(message?.content || message?.body?.content).includes(expected);
}

export function parseLarkDmSmokeArgs(argv = []) {
  const options = {
    apply: false,
    help: false,
    json: false,
    provider: null,
    timeoutMs: 180_000,
    pollMs: 2000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--provider') {
      index += 1;
      if (!argv[index]) throw new TypeError('--provider requires a value.');
      options.provider = argv[index];
    } else if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length);
    } else if (arg === '--timeout-ms') {
      index += 1;
      if (!argv[index]) throw new TypeError('--timeout-ms requires a value.');
      options.timeoutMs = normalizePositiveInteger(argv[index], options.timeoutMs, '--timeout-ms');
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = normalizePositiveInteger(
        arg.slice('--timeout-ms='.length),
        options.timeoutMs,
        '--timeout-ms',
      );
    } else if (arg === '--poll-ms') {
      index += 1;
      if (!argv[index]) throw new TypeError('--poll-ms requires a value.');
      options.pollMs = normalizePositiveInteger(argv[index], options.pollMs, '--poll-ms');
    } else if (arg.startsWith('--poll-ms=')) {
      options.pollMs = normalizePositiveInteger(
        arg.slice('--poll-ms='.length),
        options.pollMs,
        '--poll-ms',
      );
    } else {
      throw new TypeError(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export function inspectLarkDmSmokeAuth(payload) {
  const bot = payload?.identities?.bot || {};
  const user = payload?.identities?.user || {};
  const botOpenId = normalizeText(bot.openId || bot.open_id);
  const botReady = bot.available === true && normalizeText(bot.status).toLowerCase() === 'ready' && Boolean(botOpenId);
  const userReady = user.available === true && normalizeText(user.status).toLowerCase() === 'ready';
  const userSendScope = normalizeScopes(user.scope || user.scopes).has(LARK_USER_SEND_SCOPE);
  return {
    ok: botReady && userReady && userSendScope,
    botReady,
    userReady,
    userSendScope,
    botOpenId,
  };
}

export function formatLarkDmSmokeError(error) {
  return SAFE_ERROR_MESSAGES[normalizeText(error?.code)] || 'Lark DM smoke failed.';
}

export function buildLarkDmSmokeCases({ nativeProfileCommand, nonce } = {}) {
  const command = normalizeText(nativeProfileCommand).replace(/^\/+/, '');
  const key = normalizeText(nonce).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  if (!command) throw new TypeError('Lark DM smoke requires a native profile command.');
  if (!key) throw new TypeError('Lark DM smoke requires a nonce.');
  const promptMarker = `LARK_DM_PROMPT_OK_${key}`;
  const unknownMarker = `LARK_DM_UNKNOWN_OK_${key}`;
  return [
    {
      id: 'ordinary_prompt',
      text: `这是飞书私聊 smoke。不要调用工具，只回复精确字符串 ${promptMarker}`,
      expectedMarker: promptMarker,
    },
    {
      id: 'native_command_with_argument',
      text: `/${command} status`,
      expectedMarker: null,
    },
    {
      id: 'unknown_slash_path_fallback',
      text: `/lark_smoke_unknown_${key} 这不是命令。不要调用工具，只回复精确字符串 ${unknownMarker}`,
      expectedMarker: unknownMarker,
    },
  ];
}

export function normalizeLarkDmMessages(payload) {
  const items = Array.isArray(payload)
    ? payload
    : payload?.data?.messages || payload?.data?.items || payload?.messages || payload?.items;
  return Array.isArray(items) ? items : [];
}

export function findLarkDmSmokeReply(messages, { replyToMessageId, expectedMarker = null } = {}) {
  const replyTo = normalizeText(replyToMessageId);
  if (!replyTo) return null;
  return (messages || []).find((message) => (
    ['app', 'bot'].includes(normalizeSenderType(message))
    && normalizeText(message?.reply_to || message?.replyTo) === replyTo
    && messageContains(message, expectedMarker)
  )) || null;
}

function normalizeSendResult(payload) {
  const messageId = normalizeText(payload?.data?.message_id || payload?.message_id);
  const chatId = normalizeText(payload?.data?.chat_id || payload?.chat_id);
  if (!messageId || !chatId) {
    const error = new Error('Lark DM smoke send returned no message/chat identifier.');
    error.code = 'lark_dm_smoke_send_invalid';
    throw error;
  }
  return { messageId, chatId };
}

export async function runLarkDmSmoke({
  executeCli,
  botOpenId,
  cases,
  timeoutMs = 180_000,
  pollMs = 2000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  if (typeof executeCli !== 'function') throw new TypeError('Lark DM smoke requires executeCli().');
  const target = normalizeText(botOpenId);
  if (!target) throw new TypeError('Lark DM smoke requires a bot open ID.');
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('Lark DM smoke requires at least one case.');
  const timeout = normalizePositiveInteger(timeoutMs, 180_000, 'timeoutMs');
  const poll = normalizePositiveInteger(pollMs, 2000, 'pollMs');
  const results = [];

  for (let index = 0; index < cases.length; index += 1) {
    const smokeCase = cases[index];
    const startedAt = Number(now()) || Date.now();
    const sentPayload = await executeCli([
      'im',
      '+messages-send',
      '--as',
      'user',
      '--user-id',
      target,
      '--text',
      smokeCase.text,
      '--idempotency-key',
      `lark-dm-smoke-${startedAt.toString(36)}-${index}`.slice(0, 50),
    ]);
    const sent = normalizeSendResult(sentPayload);
    let reply = null;
    let attempts = 0;
    while ((Number(now()) || Date.now()) - startedAt < timeout) {
      attempts += 1;
      await sleep(poll);
      const messagePayload = await executeCli([
        'im',
        '+chat-messages-list',
        '--as',
        'user',
        '--chat-id',
        sent.chatId,
        '--page-size',
        '50',
        '--order',
        'desc',
        '--no-reactions',
      ]);
      reply = findLarkDmSmokeReply(normalizeLarkDmMessages(messagePayload), {
        replyToMessageId: sent.messageId,
        expectedMarker: smokeCase.expectedMarker,
      });
      if (reply) break;
    }
    const elapsedMs = Math.max(0, (Number(now()) || Date.now()) - startedAt);
    const result = {
      id: smokeCase.id,
      ok: Boolean(reply),
      attempts,
      elapsedMs,
    };
    results.push(result);
    if (!reply) {
      const error = new Error(`Lark DM smoke timed out in case ${smokeCase.id}.`);
      error.code = 'lark_dm_smoke_timeout';
      error.results = results;
      throw error;
    }
  }

  return results;
}
