import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNativeImagePromptNote,
  isImageAttachment,
  stageNativeImageAttachments,
} from '../src/native-image-inputs.js';

test('isImageAttachment matches image content types and extensions', () => {
  assert.equal(isImageAttachment({ name: 'demo.jpg', contentType: 'application/octet-stream' }), true);
  assert.equal(isImageAttachment({ name: 'demo.bin', contentType: 'image/png' }), true);
  assert.equal(isImageAttachment({ name: 'demo.txt', contentType: 'text/plain' }), false);
  assert.equal(isImageAttachment({ name: 'normalized.bin', mimeType: 'image/webp' }), true);
});

test('buildNativeImagePromptNote is empty without images', () => {
  assert.equal(buildNativeImagePromptNote([]), '');
  assert.match(buildNativeImagePromptNote(['/tmp/demo.jpg']), /原生图片输入/);
});

test('stageNativeImageAttachments downloads image attachments and cleans up temp dir', async () => {
  const writes = [];
  const removes = [];
  const message = {
    attachments: new Map([
      ['1', { name: 'one.jpg', contentType: 'image/jpeg', url: 'https://example.com/one.jpg' }],
      ['2', { name: 'notes.txt', contentType: 'text/plain', url: 'https://example.com/notes.txt' }],
      ['3', { name: 'two.png', contentType: 'image/png', url: 'https://example.com/two.png' }],
    ]),
  };

  const result = await stageNativeImageAttachments(message, {
    fetchImpl: async (url) => ({
      ok: true,
      async arrayBuffer() {
        return Buffer.from(`file:${url}`);
      },
    }),
    mkdtempFn: async () => '/tmp/aid-codex-images-test',
    writeFileFn: async (filePath, bytes) => {
      writes.push({ filePath, bytes: bytes.toString('utf8') });
    },
    rmFn: async (dir, options) => {
      removes.push({ dir, options });
    },
    tmpdir: '/tmp',
  });

  assert.deepEqual(result.inputImages, [
    '/tmp/aid-codex-images-test/01-one.jpg',
    '/tmp/aid-codex-images-test/02-two.png',
  ]);
  assert.equal(result.notes.length, 0);
  assert.deepEqual(writes, [
    { filePath: '/tmp/aid-codex-images-test/01-one.jpg', bytes: 'file:https://example.com/one.jpg' },
    { filePath: '/tmp/aid-codex-images-test/02-two.png', bytes: 'file:https://example.com/two.png' },
  ]);

  await result.cleanup();
  assert.deepEqual(removes, [
    { dir: '/tmp/aid-codex-images-test', options: { recursive: true, force: true } },
  ]);
});

test('stageNativeImageAttachments accepts normalized-only message attachments', async () => {
  const writes = [];
  const message = {
    actor: { id: 'user-1' },
    conversation: { id: 'conversation-1', parentId: null, isThread: false },
    attachments: [{
      id: 'image-1',
      name: 'normalized-image',
      mimeType: 'image/png',
      sizeBytes: 10,
      url: 'https://example.com/normalized-image',
    }],
  };

  const result = await stageNativeImageAttachments(message, {
    fetchImpl: async () => ({
      ok: true,
      async arrayBuffer() {
        return Buffer.from('normalized-image');
      },
    }),
    mkdtempFn: async () => '/tmp/aid-codex-images-normalized',
    writeFileFn: async (filePath, bytes) => {
      writes.push({ filePath, bytes: bytes.toString('utf8') });
    },
    rmFn: async () => {},
    tmpdir: '/tmp',
  });

  assert.deepEqual(result.inputImages, [
    '/tmp/aid-codex-images-normalized/01-normalized-image.png',
  ]);
  assert.deepEqual(writes, [{
    filePath: '/tmp/aid-codex-images-normalized/01-normalized-image.png',
    bytes: 'normalized-image',
  }]);
});

test('stageNativeImageAttachments keeps URL fallback notes when image download fails', async () => {
  const message = {
    attachments: new Map([
      ['1', { name: 'broken.jpg', contentType: 'image/jpeg', url: 'https://example.com/broken.jpg' }],
    ]),
  };

  const result = await stageNativeImageAttachments(message, {
    fetchImpl: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
    mkdtempFn: async () => '/tmp/aid-codex-images-test',
    writeFileFn: async () => {},
    rmFn: async () => {},
    tmpdir: '/tmp',
  });

  assert.deepEqual(result.inputImages, []);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /下载失败/);
});
