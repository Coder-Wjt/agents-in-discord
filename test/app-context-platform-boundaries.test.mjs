import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('app context consumes platform services through one foundation boundary', async () => {
  const source = await readFile(new URL('../src/app-context.js', import.meta.url), 'utf8');

  assert.match(source, /assertPlatformFoundation/);
  assert.match(source, /resolvedPlatformFoundation\.createAdapter/);
  assert.doesNotMatch(source, /createMessageDeliveryFn\s*\(/);
  assert.doesNotMatch(source, /createCommandViewRendererFn\s*\(/);
  assert.doesNotMatch(source, /createConversationSpawnFn\s*\(/);
  assert.doesNotMatch(source, /createConversationSecurityFn\s*\(/);
});
