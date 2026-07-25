import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCommandActionRow,
  createCommandButton,
  createCommandMessageView,
  createCommandModalView,
  createCommandSelect,
  createCommandTextInput,
} from '../src/platforms/command-view.js';
import { createDiscordCommandViewRenderer } from '../src/platforms/discord/command-view-renderer.js';

class FakeButtonBuilder {
  constructor() {
    this.data = {};
  }

  setCustomId(value) {
    this.data.customId = value;
    return this;
  }

  setLabel(value) {
    this.data.label = value;
    return this;
  }

  setStyle(value) {
    this.data.style = value;
    return this;
  }

  setDisabled(value) {
    this.data.disabled = value;
    return this;
  }
}

class FakeActionRowBuilder {
  constructor() {
    this.components = [];
  }

  addComponents(...components) {
    this.components.push(...components);
    return this;
  }
}

test('Discord renderer maps message buttons and selects to raw API payloads', () => {
  const renderer = createDiscordCommandViewRenderer();
  const payload = renderer.renderMessage(createCommandMessageView({
    content: 'Pick one',
    visibility: 'ephemeral',
    rows: [createCommandActionRow([
      createCommandButton({ id: 'retry:12345', label: 'Retry', style: 'primary' }),
      createCommandSelect({
        id: 'provider',
        placeholder: 'Provider',
        options: [{ label: 'Codex', value: 'codex', description: 'OpenAI CLI' }],
      }),
    ])],
  }));

  assert.deepEqual(payload, {
    content: 'Pick one',
    flags: 64,
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Retry', custom_id: 'retry:12345' },
        {
          type: 3,
          custom_id: 'provider',
          options: [{ label: 'Codex', value: 'codex', description: 'OpenAI CLI' }],
          placeholder: 'Provider',
          min_values: 1,
          max_values: 1,
        },
      ],
    }],
  });
});

test('Discord renderer maps modal text inputs to raw API payloads', () => {
  const renderer = createDiscordCommandViewRenderer();
  const modal = renderer.renderModal(createCommandModalView({
    id: 'goal:create',
    title: 'Create goal',
    rows: [createCommandActionRow([
      createCommandTextInput({
        id: 'goal',
        label: 'Goal',
        style: 'paragraph',
        placeholder: 'Describe the outcome',
        minLength: 3,
        maxLength: 1000,
      }),
    ])],
  }));

  assert.deepEqual(modal, {
    custom_id: 'goal:create',
    title: 'Create goal',
    components: [{
      type: 1,
      components: [{
        type: 4,
        custom_id: 'goal',
        label: 'Goal',
        style: 2,
        required: true,
        placeholder: 'Describe the outcome',
        min_length: 3,
        max_length: 1000,
      }],
    }],
  });
});

test('Discord renderer uses supplied builders for action rows', () => {
  const renderer = createDiscordCommandViewRenderer({
    ActionRowBuilder: FakeActionRowBuilder,
    ButtonBuilder: FakeButtonBuilder,
    ButtonStyle: { Primary: 'primary' },
  });

  const [row] = renderer.renderActionRows([createCommandActionRow([
    createCommandButton({ id: 'retry:12345', label: 'Retry', style: 'primary', disabled: true }),
  ])]);

  assert.equal(row instanceof FakeActionRowBuilder, true);
  assert.equal(row.components[0] instanceof FakeButtonBuilder, true);
  assert.deepEqual(row.components[0].data, {
    customId: 'retry:12345',
    label: 'Retry',
    style: 'primary',
    disabled: true,
  });
});
