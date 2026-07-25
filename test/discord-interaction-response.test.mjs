import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
  createCommandModalView,
  createCommandTextInput,
} from '../src/platforms/command-view.js';
import { createDiscordCommandViewRenderer } from '../src/platforms/discord/command-view-renderer.js';
import { createDiscordInteractionResponse } from '../src/platforms/discord/interaction-response.js';

function createResponse(retries = []) {
  return createDiscordInteractionResponse({
    commandViewRenderer: createDiscordCommandViewRenderer(),
    withDiscordNetworkRetry: async (operation, options) => {
      retries.push(options);
      return operation();
    },
  });
}

test('Discord interaction response renders ephemeral replies and deferred edits', async () => {
  const retries = [];
  const response = createResponse(retries);
  const replies = [];
  const edits = [];
  const interaction = {
    customId: 'settings:open',
    deferred: false,
    replied: false,
    async reply(payload) {
      replies.push(payload);
    },
    async editReply(payload) {
      edits.push(payload);
    },
  };
  const view = createCommandMessageView({
    content: 'Settings',
    visibility: 'ephemeral',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'settings:close', label: 'Close' }),
    ])],
  });

  await response.respond(interaction, view);
  interaction.deferred = true;
  await response.respond(interaction, view);

  assert.equal(replies[0].flags, 64);
  assert.equal(replies[0].components[0].components[0].custom_id, 'settings:close');
  assert.equal('flags' in edits[0], false);
  assert.equal(edits[0].components[0].components[0].custom_id, 'settings:close');
  assert.deepEqual(retries.map((item) => item.label), [
    'interaction:settings:open reply',
    'interaction:settings:open editReply',
  ]);
});

test('Discord interaction response renders updates, modals, and ephemeral defers', async () => {
  const response = createResponse();
  const updates = [];
  const modals = [];
  const defers = [];
  const interaction = {
    commandName: 'settings',
    async update(payload) {
      updates.push(payload);
    },
    async showModal(payload) {
      modals.push(payload);
    },
    async deferReply(payload) {
      defers.push(payload);
    },
  };

  await response.update(interaction, createCommandMessageView({
    content: 'Updated',
    visibility: 'ephemeral',
  }));
  await response.showModal(interaction, createCommandModalView({
    id: 'settings:model',
    title: 'Model',
    rows: [createCommandActionRow([
      createCommandTextInput({ id: 'model', label: 'Model' }),
    ])],
  }));
  await response.defer(interaction, { visibility: 'ephemeral' });

  assert.deepEqual(updates, [{ content: 'Updated', components: [] }]);
  assert.equal(modals[0].custom_id, 'settings:model');
  assert.equal(modals[0].components[0].components[0].custom_id, 'model');
  assert.deepEqual(defers, [{ flags: 64 }]);
});

test('Discord interaction response rejects platform-native payloads from core', async () => {
  const response = createResponse();

  await assert.rejects(
    response.respond({ reply() {} }, { content: 'bad', flags: 64 }),
    /cannot contain platform-native flags or components/,
  );
});

test('Discord interaction response unwraps normalized inbound interaction envelopes', async () => {
  const response = createResponse();
  const replies = [];
  const target = {
    deferred: false,
    replied: false,
    async reply(payload) {
      replies.push(payload);
    },
  };
  const event = {
    type: 'interaction',
    kind: 'command',
    command: { name: 'status' },
    responseTarget: target,
  };

  await response.respond(event, createCommandMessageView({
    content: 'Status',
    visibility: 'ephemeral',
  }));

  assert.deepEqual(replies, [{ content: 'Status', components: [], flags: 64 }]);
});
