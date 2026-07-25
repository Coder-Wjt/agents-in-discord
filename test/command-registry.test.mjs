import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMAND_OPTION_TYPES,
  COMMAND_REGISTRY_RENDERER_METHODS,
  assertCommandRegistryRenderer,
  createCommandOption,
  createCommandSpec,
} from '../src/platforms/command-registry.js';

test('command specs normalize platform-independent options and aliases', () => {
  const spec = createCommandSpec({
    name: 'resume',
    description: 'Resume a session',
    aliases: ['rollout_resume'],
    aliasDescriptions: { rollout_resume: 'Resume a rollout' },
    options: [{
      name: 'session_id',
      description: 'Session UUID',
      required: true,
      choices: [{ name: 'Recent', value: 'recent' }],
    }],
  });

  assert.deepEqual(COMMAND_OPTION_TYPES, ['string']);
  assert.deepEqual(spec, {
    name: 'resume',
    description: 'Resume a session',
    aliases: ['rollout_resume'],
    aliasDescriptions: { rollout_resume: 'Resume a rollout' },
    options: [{
      type: 'string',
      name: 'session_id',
      description: 'Session UUID',
      required: true,
      choices: [{ name: 'Recent', value: 'recent' }],
    }],
  });
  assert.equal(Object.isFrozen(spec.aliasDescriptions), true);
});

test('command registry contracts reject invalid specs and renderers', () => {
  assert.throws(
    () => createCommandSpec({
      name: 'fork',
      description: 'Fork',
      requiredCapabilities: ['telepathy'],
    }),
    /Unsupported required platform capability/,
  );
  assert.throws(
    () => createCommandOption({ type: 'integer', name: 'count', description: 'Count' }),
    /Unsupported command option type/,
  );
  assert.throws(
    () => createCommandSpec({ name: '', description: 'Missing name' }),
    /command name must be a non-empty string/,
  );
  assert.throws(
    () => assertCommandRegistryRenderer({ renderCommands() {} }),
    /must provide formatCommandName\(\)/,
  );

  const renderer = Object.fromEntries(COMMAND_REGISTRY_RENDERER_METHODS.map((method) => [method, () => {}]));
  assert.equal(assertCommandRegistryRenderer(renderer), renderer);
});
