import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
  createCommandModalView,
  createCommandSelect,
  createCommandSpec,
  createCommandTextInput,
  createPlatformCapabilities,
  createCapabilityAwareCommandRegistryRenderer,
  createCapabilityAwareCommandViewRenderer,
  createCapabilityAwareInteractionResponse,
} from '../src/platforms/index.js';

function createRegistryRenderer(renderedSpecs = []) {
  return {
    renderCommands(specs) {
      renderedSpecs.push(...specs);
      return specs.map((spec) => spec.name);
    },
    formatCommandName: (name) => `native-${name}`,
    normalizeCommandName: (name) => String(name).replace(/^native-/, ''),
    formatCommandReference: (name) => `/native-${name}`,
  };
}

test('capability-aware command registry hides unsupported commands and uses text references', () => {
  const renderedSpecs = [];
  const nativeRenderer = createRegistryRenderer(renderedSpecs);
  const noSlashRenderer = createCapabilityAwareCommandRegistryRenderer({
    capabilities: createPlatformCapabilities(),
    renderer: nativeRenderer,
  });
  const commands = [
    createCommandSpec({ name: 'status', description: 'Status' }),
    createCommandSpec({
      name: 'fork',
      description: 'Fork',
      requiredCapabilities: ['threads'],
    }),
  ];

  assert.deepEqual(noSlashRenderer.renderCommands(commands), []);
  assert.equal(noSlashRenderer.formatCommandReference('status'), '!status');

  const nativeWithNoThreads = createCapabilityAwareCommandRegistryRenderer({
    capabilities: createPlatformCapabilities({ slashCommands: true }),
    renderer: nativeRenderer,
  });
  assert.deepEqual(nativeWithNoThreads.renderCommands(commands), ['status']);
  assert.deepEqual(renderedSpecs.map((spec) => spec.name), ['status']);
  assert.equal(nativeWithNoThreads.formatCommandReference('status'), '/native-status');
});

test('capability-aware command view removes unsupported controls and appends actionable fallback', () => {
  const rendered = [];
  const renderer = createCapabilityAwareCommandViewRenderer({
    capabilities: createPlatformCapabilities(),
    renderer: {
      renderActionRows: (rows) => rows,
      renderMessage(view) {
        rendered.push(view);
        return view;
      },
      renderModal: (view) => view,
    },
  });
  const view = createCommandMessageView({
    content: 'Settings',
    fallbackText: 'Use `!model` and `!effort`.',
    rows: [
      createCommandActionRow([
        createCommandButton({ id: 'settings:close', label: 'Close' }),
      ]),
      createCommandActionRow([
        createCommandSelect({
          id: 'settings:model',
          placeholder: 'Choose model',
          options: [{ label: 'o3', value: 'o3' }],
        }),
      ]),
    ],
  });

  const payload = renderer.renderMessage(view);

  assert.equal(payload.content, 'Settings\n\nUse `!model` and `!effort`.');
  assert.deepEqual(payload.rows, []);
  assert.equal(rendered[0], payload);
});

test('capability-aware command view preserves supported controls and filters only missing ones', () => {
  const renderer = createCapabilityAwareCommandViewRenderer({
    capabilities: createPlatformCapabilities({ buttons: true }),
    renderer: {
      renderActionRows: (rows) => rows,
      renderMessage: (view) => view,
      renderModal: (view) => view,
    },
  });
  const button = createCommandButton({ id: 'retry', label: 'Retry' });
  const select = createCommandSelect({
    id: 'model',
    placeholder: 'Model',
    options: [{ label: 'o3', value: 'o3' }],
  });

  const payload = renderer.renderMessage(createCommandMessageView({
    content: 'Failure',
    rows: [createCommandActionRow([button, select])],
  }));

  assert.deepEqual(payload.rows, [createCommandActionRow([button])]);
  assert.match(payload.content, /Interactive controls are unavailable/);
  assert.match(payload.content, /Model: o3 \(o3\)/);
});

test('capability-aware interaction response replaces unsupported modals with fallback messages', async () => {
  const calls = [];
  const response = createCapabilityAwareInteractionResponse({
    capabilities: createPlatformCapabilities({ buttons: true }),
    interactionResponse: {
      respond: async (interaction, view) => calls.push(['respond', interaction, view]),
      update: async (interaction, view) => calls.push(['update', interaction, view]),
      showModal: async (interaction, view) => calls.push(['showModal', interaction, view]),
      defer: async (interaction, options) => calls.push(['defer', interaction, options]),
    },
  });
  const interaction = { id: 'interaction-1' };
  const modal = createCommandModalView({
    id: 'settings:model',
    title: 'Model',
    rows: [createCommandActionRow([
      createCommandTextInput({ id: 'model', label: 'Model name' }),
    ])],
    fallback: {
      content: 'Use `!model <name>`.',
      visibility: 'ephemeral',
    },
  });

  await response.showModal(interaction, modal);

  assert.deepEqual(calls, [[
    'respond',
    interaction,
    createCommandMessageView({
      content: 'Use `!model <name>`.',
      visibility: 'ephemeral',
    }),
  ]]);
});

test('capability-aware interaction response sends a new response when message edits are unsupported', async () => {
  const calls = [];
  const response = createCapabilityAwareInteractionResponse({
    capabilities: createPlatformCapabilities({ buttons: true }),
    interactionResponse: {
      respond: async (interaction, view) => calls.push(['respond', interaction, view]),
      update: async (interaction, view) => calls.push(['update', interaction, view]),
      showModal: async (interaction, view) => calls.push(['showModal', interaction, view]),
      defer: async (interaction, options) => calls.push(['defer', interaction, options]),
    },
  });
  const interaction = { id: 'interaction-1' };
  const view = createCommandMessageView({ content: 'Updated settings' });

  await response.update(interaction, view);

  assert.deepEqual(calls, [['respond', interaction, view]]);
});
