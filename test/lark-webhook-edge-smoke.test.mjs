import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  encryptLarkWebhookPayload,
  extractCloudflaredQuickTunnelUrl,
  formatLarkWebhookEdgeSmokeError,
  parseLarkWebhookEdgeSmokeArgs,
  signLarkWebhookBody,
} from '../src/lark-webhook-edge-smoke.js';

test('Lark webhook edge smoke keeps the public tunnel explicit', () => {
  assert.deepEqual(parseLarkWebhookEdgeSmokeArgs([]), {
    apply: false,
    help: false,
    json: false,
    tunnelBin: 'cloudflared',
    timeoutMs: 120_000,
    pollMs: 1000,
  });
  assert.deepEqual(parseLarkWebhookEdgeSmokeArgs([
    '--apply',
    '--json',
    '--tunnel-bin=/opt/cloudflared',
    '--timeout-ms=90000',
    '--poll-ms=500',
  ]), {
    apply: true,
    help: false,
    json: true,
    tunnelBin: '/opt/cloudflared',
    timeoutMs: 90_000,
    pollMs: 500,
  });
  assert.throws(() => parseLarkWebhookEdgeSmokeArgs(['--apply-now']), /Unknown option/);
});

test('Lark webhook edge smoke extracts only account-less HTTPS tunnel URLs', () => {
  assert.equal(
    extractCloudflaredQuickTunnelUrl('\u001b[32mINF\u001b[0m https://safe-edge.trycloudflare.com ready'),
    'https://safe-edge.trycloudflare.com',
  );
  assert.equal(extractCloudflaredQuickTunnelUrl('http://safe-edge.trycloudflare.com'), null);
  assert.equal(extractCloudflaredQuickTunnelUrl('https://example.com'), null);
});

test('Lark webhook edge smoke creates SDK-compatible encrypted signatures without exposing secrets', () => {
  const encryptKey = 'edge-encrypt-key';
  const iv = Buffer.alloc(16, 7);
  const payload = { schema: '2.0', event: { value: 42 } };
  const encrypt = encryptLarkWebhookPayload(payload, encryptKey, { iv });
  const encrypted = Buffer.from(encrypt, 'base64');
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    crypto.createHash('sha256').update(encryptKey).digest(),
    encrypted.subarray(0, 16),
  );
  const decrypted = Buffer.concat([
    decipher.update(encrypted.subarray(16)),
    decipher.final(),
  ]).toString('utf8');
  assert.deepEqual(JSON.parse(decrypted), payload);

  const body = { encrypt };
  const signature = signLarkWebhookBody(body, encryptKey, '123', 'nonce');
  assert.equal(signature, crypto.createHash('sha256')
    .update(`123nonce${encryptKey}${JSON.stringify(body)}`)
    .digest('hex'));
  assert.doesNotMatch(formatLarkWebhookEdgeSmokeError({ message: encryptKey }), /edge-encrypt-key/);
});
