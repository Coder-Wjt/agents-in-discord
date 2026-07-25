import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('core security policy does not inspect Discord permission or channel APIs', async () => {
  const source = await readFile(new URL('../src/security-policy.js', import.meta.url), 'utf8');

  assert.match(source, /conversationSecurityResolver/);
  assert.doesNotMatch(source, /\.isThread\s*\(/);
  assert.doesNotMatch(source, /\.isDMBased\s*\(/);
  assert.doesNotMatch(source, /\.permissionsFor\s*\(/);
  assert.doesNotMatch(source, /roles\?*\.everyone/);
  assert.doesNotMatch(source, /permissionFlagsBits/);
});
