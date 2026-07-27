import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMessageContent,
  parseSendChannelMessageArgs,
  resolveSendChannelMessageContent,
} from '../src/send-channel-message.js';

test('parseSendChannelMessageArgs accepts channel, content, provider, and json flags', () => {
  const parsed = parseSendChannelMessageArgs([
    '--channel', '123456789012345678',
    '--content', 'deploy ok',
    '--provider', 'codex',
    '--json',
  ]);

  assert.deepEqual(parsed, {
    channelId: '123456789012345678',
    content: 'deploy ok',
    contentFile: '',
    stdin: false,
    json: true,
    provider: 'codex',
    nonce: '',
    help: false,
  });
});

test('parseSendChannelMessageArgs accepts a bounded nonce and rejects unsafe values', () => {
  const parsed = parseSendChannelMessageArgs([
    '--channel', '123456789012345678',
    '--content', 'retry-safe report',
    '--nonce', 'f4dd93b1c73042aa9784a4195',
  ]);

  assert.equal(parsed.nonce, 'f4dd93b1c73042aa9784a4195');
  assert.throws(
    () => parseSendChannelMessageArgs(['--channel', '123456789012345678', '--content', 'x', '--nonce', 'x'.repeat(26)]),
    /invalid --nonce/i,
  );
  assert.throws(
    () => parseSendChannelMessageArgs(['--channel', '123456789012345678', '--content', 'x', '--nonce', 'bad nonce']),
    /invalid --nonce/i,
  );
});

test('parseSendChannelMessageArgs rejects invalid input combinations', () => {
  assert.throws(
    () => parseSendChannelMessageArgs(['--channel', 'bad-id', '--content', 'x']),
    /invalid --channel/i,
  );
  assert.throws(
    () => parseSendChannelMessageArgs(['--channel', '123456789012345678', '--content', 'x', '--stdin']),
    /Choose only one content source/i,
  );
});

test('parseSendChannelMessageArgs accepts the ZCode provider', () => {
  const parsed = parseSendChannelMessageArgs([
    '--channel', '123456789012345678',
    '--content', 'zcode online',
    '--provider', 'zcode',
  ]);

  assert.equal(parsed.provider, 'zcode');
});

test('resolveSendChannelMessageContent supports inline, file, and stdin input', async () => {
  assert.equal(
    await resolveSendChannelMessageContent({ channelId: '1', content: 'hello', contentFile: '', stdin: false }),
    'hello',
  );
  assert.equal(
    await resolveSendChannelMessageContent(
      { channelId: '1', content: null, contentFile: '/tmp/msg.txt', stdin: false },
      { readFile: async () => 'from file' },
    ),
    'from file',
  );
  assert.equal(
    await resolveSendChannelMessageContent(
      { channelId: '1', content: null, contentFile: '', stdin: false },
      {
        stdin: { isTTY: false },
        readStdin: async () => 'from stdin',
      },
    ),
    'from stdin',
  );
});

test('normalizeMessageContent enforces non-empty and Discord length limit', () => {
  assert.throws(() => normalizeMessageContent('   '), /empty/i);
  assert.throws(() => normalizeMessageContent('x'.repeat(2001)), /Discord limit/i);
  assert.equal(normalizeMessageContent('ok'), 'ok');
});
