import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLarkCommandRegistryRenderer,
  formatLarkCommandName,
  normalizeLarkCommandName,
} from '../src/platforms/lark/command-registry-renderer.js';

test('Lark command registry renderer emits native app slash-command descriptors', () => {
  const renderer = createLarkCommandRegistryRenderer({ slashPrefix: 'cx' });
  const commands = renderer.renderCommands([{
    name: 'status',
    aliases: ['state'],
    aliasDescriptions: { state: '状态别名' },
    description: '查看状态',
  }]);

  assert.deepEqual(commands, [
    { command: 'cx_status', description: '查看状态' },
    { command: 'cx_state', description: '状态别名' },
  ]);
  assert.equal(renderer.formatCommandReference('status'), '/cx_status');
  assert.equal(renderer.normalizeCommandName('/cx_status@sample_bot'), 'status');
});

test('Lark native slash-command names obey the platform length limit', () => {
  const formatted = formatLarkCommandName('a'.repeat(100), 'provider');

  assert.equal(formatted.length, 64);
  assert.equal(formatted.startsWith('provider_'), true);
  assert.equal(normalizeLarkCommandName('/provider_status@bot', 'provider'), 'status');
});
