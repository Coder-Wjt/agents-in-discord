import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseWechatMessage,
  splitWechatText,
  WechatILinkClient,
} from '../src/wechat/ilink-client.js';

test('parseWechatMessage reads text voice and quoted content without exposing media', () => {
  const parsed = parseWechatMessage({
    item_list: [
      { type: 1, text_item: { text: '修复这个问题' } },
      { type: 3, voice_item: { text: '然后运行测试' } },
      { type: 2, image_item: { media: {} } },
      {
        type: 1,
        ref_msg: {
          message_item: { text_item: { text: '上一条回复' } },
        },
      },
    ],
  });

  assert.equal(parsed.text, '修复这个问题\n然后运行测试');
  assert.equal(parsed.quotedText, '上一条回复');
  assert.equal(parsed.unsupportedMedia, 1);
});

test('splitWechatText keeps every chunk within the WeChat limit', () => {
  const text = `${'a'.repeat(1200)}\n\n${'b'.repeat(1200)}\n${'c'.repeat(1200)}`;
  const chunks = splitWechatText(text, 2000);

  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 2000));
  assert.equal(chunks.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('WechatILinkClient does not block polling while a task handler is running', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-wechat-ilink-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let release = null;
  const running = new Promise((resolve) => {
    release = resolve;
  });
  const client = new WechatILinkClient({
    credentials: { botToken: 'token', baseUrl: 'https://example.test' },
    pollCursorFile: path.join(root, 'cursor'),
    contextTokensFile: path.join(root, 'tokens.json'),
  });
  client.onMessage(async () => running);

  await client.processMessage({
    message_type: 1,
    message_id: 1,
    from_user_id: 'user-1',
    context_token: 'context',
    item_list: [{ type: 1, text_item: { text: 'run' } }],
  });
  release();
});
