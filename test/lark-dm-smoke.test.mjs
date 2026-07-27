import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLarkDmSmokeCases,
  findLarkDmSmokeReply,
  formatLarkDmSmokeError,
  inspectLarkDmSmokeAuth,
  normalizeLarkDmMessages,
  parseLarkDmSmokeArgs,
  runLarkDmSmoke,
} from '../src/lark-dm-smoke.js';

test('Lark DM smoke argument parser keeps writes explicit', () => {
  assert.deepEqual(parseLarkDmSmokeArgs([]), {
    apply: false,
    help: false,
    json: false,
    provider: null,
    timeoutMs: 180000,
    pollMs: 2000,
  });
  assert.deepEqual(parseLarkDmSmokeArgs([
    '--apply',
    '--json',
    '--provider=codex',
    '--timeout-ms=9000',
    '--poll-ms',
    '250',
  ]), {
    apply: true,
    help: false,
    json: true,
    provider: 'codex',
    timeoutMs: 9000,
    pollMs: 250,
  });
  assert.throws(() => parseLarkDmSmokeArgs(['--apply-now']), /Unknown option/);
});

test('Lark DM smoke auth requires ready bot/user identities and user-send scope', () => {
  const auth = inspectLarkDmSmokeAuth({
    identities: {
      bot: { available: true, status: 'ready', openId: 'ou_bot' },
      user: { available: true, status: 'ready', scope: 'im:message.read im:message.send_as_user' },
    },
  });
  assert.equal(auth.ok, true);
  assert.equal(auth.botOpenId, 'ou_bot');
  assert.equal(inspectLarkDmSmokeAuth({
    identities: {
      bot: { available: true, status: 'ready', openId: 'ou_bot' },
      user: { available: true, status: 'ready', scope: 'im:message.read' },
    },
  }).ok, false);
});

test('Lark DM smoke errors never expose raw CLI details', () => {
  const sensitive = 'om_secret cli_profile_secret message body';
  assert.equal(formatLarkDmSmokeError({
    code: 'lark_dm_smoke_cli_error',
    message: sensitive,
    stderr: JSON.stringify({ error: { message: sensitive } }),
  }), 'lark-cli operation failed.');
  assert.equal(formatLarkDmSmokeError({ message: sensitive }), 'Lark DM smoke failed.');
});

test('Lark DM smoke cases cover prompt, parameterized native command, and unknown path', () => {
  const cases = buildLarkDmSmokeCases({ nativeProfileCommand: 'cx_profile', nonce: 'abc123' });
  assert.deepEqual(cases.map((item) => item.id), [
    'ordinary_prompt',
    'native_command_with_argument',
    'unknown_slash_path_fallback',
  ]);
  assert.equal(cases[1].text, '/cx_profile status');
  assert.match(cases[0].expectedMarker, /abc123/);
  assert.match(cases[2].text, /^\/lark_smoke_unknown_abc123/);
});

test('Lark DM smoke reply matching requires an associated app reply and marker', () => {
  const messages = [
    { sender: { sender_type: 'user' }, reply_to: 'om_1', content: '{"text":"MARK"}' },
    { sender: { sender_type: 'app' }, reply_to: 'om_other', content: '{"text":"MARK"}' },
    { sender: { sender_type: 'app' }, reply_to: 'om_1', content: '{"text":"MARK"}' },
  ];
  assert.equal(findLarkDmSmokeReply(messages, {
    replyToMessageId: 'om_1',
    expectedMarker: 'MARK',
  }), messages[2]);
  assert.equal(findLarkDmSmokeReply(messages, {
    replyToMessageId: 'om_1',
    expectedMarker: 'MISSING',
  }), null);
});

test('Lark DM smoke accepts the current lark-cli data.messages response shape', () => {
  const messages = [{ message_id: 'om_1' }];
  assert.equal(normalizeLarkDmMessages({ data: { messages } }), messages);
  assert.equal(normalizeLarkDmMessages({ data: { items: messages } }), messages);
});

test('Lark DM smoke runner sends cases sequentially and reports only redacted outcomes', async () => {
  let clock = 1000;
  let sent = 0;
  const replies = new Map();
  const executeCli = async (args) => {
    if (args.includes('+messages-send')) {
      sent += 1;
      const messageId = `om_${sent}`;
      const text = args[args.indexOf('--text') + 1];
      const marker = text.match(/LARK_DM_(?:PROMPT|UNKNOWN)_OK_[A-Za-z0-9_-]+/)?.[0] || '';
      replies.set(messageId, marker);
      return { data: { message_id: messageId, chat_id: 'oc_private' } };
    }
    const messageId = `om_${sent}`;
    return {
      data: {
        items: [{
          sender: { sender_type: 'app' },
          reply_to: messageId,
          content: JSON.stringify({ text: replies.get(messageId) || 'profile status' }),
        }],
      },
    };
  };
  const results = await runLarkDmSmoke({
    executeCli,
    botOpenId: 'ou_bot',
    cases: buildLarkDmSmokeCases({ nativeProfileCommand: 'cx_profile', nonce: 'abc123' }),
    timeoutMs: 1000,
    pollMs: 10,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });

  assert.equal(sent, 3);
  assert.deepEqual(results.map(({ id, ok }) => ({ id, ok })), [
    { id: 'ordinary_prompt', ok: true },
    { id: 'native_command_with_argument', ok: true },
    { id: 'unknown_slash_path_fallback', ok: true },
  ]);
  assert.equal(JSON.stringify(results).includes('ou_bot'), false);
  assert.equal(JSON.stringify(results).includes('oc_private'), false);
});
