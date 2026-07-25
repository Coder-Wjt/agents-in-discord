import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandSpec } from '../src/platforms/command-registry.js';
import {
  createDiscordCommandRegistryRenderer,
  formatDiscordCommandName,
  normalizeDiscordCommandName,
} from '../src/platforms/discord/command-registry-renderer.js';

class MockSlashCommandBuilder {
  constructor() {
    this.data = { options: [] };
  }

  setName(name) {
    this.data.name = name;
    return this;
  }

  setDescription(description) {
    this.data.description = description;
    return this;
  }

  addStringOption(configure) {
    const option = {
      data: { choices: [] },
      setName(name) {
        this.data.name = name;
        return this;
      },
      setDescription(description) {
        this.data.description = description;
        return this;
      },
      setRequired(required) {
        this.data.required = required;
        return this;
      },
      addChoices(...choices) {
        this.data.choices.push(...choices);
        return this;
      },
    };
    configure(option);
    this.data.options.push(option.data);
    return this;
  }

  toJSON() {
    return this.data;
  }
}

test('Discord command registry renderer owns prefix naming and references', () => {
  const renderer = createDiscordCommandRegistryRenderer({
    SlashCommandBuilder: MockSlashCommandBuilder,
    slashPrefix: 'cx',
  });

  assert.equal(formatDiscordCommandName('STATUS', 'cx'), 'cx_status');
  assert.equal(formatDiscordCommandName('a'.repeat(40), 'prefix').length, 32);
  assert.equal(normalizeDiscordCommandName('cx_status', 'cx'), 'status');
  assert.equal(renderer.formatCommandReference('progress'), '/cx_progress');
});

test('Discord command registry renderer preserves aliases, descriptions, options, and order', () => {
  const renderer = createDiscordCommandRegistryRenderer({
    SlashCommandBuilder: MockSlashCommandBuilder,
    slashPrefix: 'cx',
  });
  const commands = renderer.renderCommands([createCommandSpec({
    name: 'resume',
    description: 'Resume session',
    aliases: ['rollout_resume'],
    aliasDescriptions: { rollout_resume: 'Resume rollout' },
    options: [
      { name: 'session_id', description: 'Session UUID', required: true },
      {
        name: 'mode',
        description: 'Resume mode',
        choices: [
          { name: 'safe', value: 'safe' },
          { name: 'fast', value: 'fast' },
        ],
      },
    ],
  })]).map((command) => command.toJSON());

  assert.deepEqual(commands.map((command) => command.name), ['cx_resume', 'cx_rollout_resume']);
  assert.deepEqual(commands.map((command) => command.description), ['Resume session', 'Resume rollout']);
  assert.deepEqual(commands[0].options.map((option) => option.name), ['session_id', 'mode']);
  assert.equal(commands[0].options[0].required, true);
  assert.deepEqual(commands[0].options[1].choices.map((choice) => choice.value), ['safe', 'fast']);
});

test('Discord command registry renderer requires the Discord builder only when rendering', () => {
  const renderer = createDiscordCommandRegistryRenderer({ slashPrefix: 'cx' });

  assert.equal(renderer.formatCommandReference('status'), '/cx_status');
  assert.throws(
    () => renderer.renderCommands([createCommandSpec({ name: 'status', description: 'Status' })]),
    /requires SlashCommandBuilder/,
  );
});
