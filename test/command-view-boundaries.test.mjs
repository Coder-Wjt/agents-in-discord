import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');

const PLATFORM_BUILDER_PATTERN = /\b(?:ActionRowBuilder|ButtonBuilder|ButtonStyle|StringSelectMenuBuilder|ModalBuilder|TextInputBuilder|TextInputStyle)\b/;
const COMMAND_VIEW_CORE_FILES = [
  'src/command-surface.js',
  'src/onboarding-flow.js',
  'src/prompt-progress-reporter.js',
  'src/retry-action-button.js',
  'src/settings-panel.js',
  'src/slash-command-router.js',
  'src/workspace-browser.js',
  'src/workspace-busy-actions.js',
];
const INTERACTION_RESPONSE_CORE_FILES = COMMAND_VIEW_CORE_FILES;
const PLATFORM_RESPONSE_PATTERN = /\bflags\s*:|\bcomponents\s*:|\bcommandViewRenderer\b|interaction\.(?:reply|update|showModal|deferReply)\s*\(/;
const COMMAND_REGISTRY_CORE_FILES = [
  'src/command-spec.js',
  'src/command-surface.js',
];
const DISCORD_COMMAND_REGISTRY_PATTERN = /\bSlashCommandBuilder\b|\baddStringOption\b|\bconfigure\s*\(\s*builder\s*\)/;
const RAW_INTERACTION_INPUT_PATTERN = /interaction(?:\?|)\.(?:commandName|channel|channelId|user|options|customId|fields|values)\b/;
const NORMALIZED_INTERACTION_CORE_FILES = [
  'src/onboarding-flow.js',
  'src/settings-panel.js',
  'src/slash-command-router.js',
  'src/workspace-browser.js',
  'src/workspace-busy-actions.js',
];
const MESSAGE_DELIVERY_CORE_FILES = [
  'src/channel-queue.js',
  'src/prompt-progress-reporter.js',
  'src/text-command-handler.js',
];
const RAW_MESSAGE_DELIVERY_PATTERN = /\.react\s*\(|reactions\.cache|target\.edit\s*\(/;

test('command view core modules do not depend on Discord component builders', () => {
  for (const relativePath of COMMAND_VIEW_CORE_FILES) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, PLATFORM_BUILDER_PATTERN, relativePath);
  }
});

test('command view core modules use the interaction response port instead of Discord payloads', () => {
  for (const relativePath of INTERACTION_RESPONSE_CORE_FILES) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, PLATFORM_RESPONSE_PATTERN, relativePath);
  }
});

test('command registry core modules do not construct Discord slash commands', () => {
  for (const relativePath of COMMAND_REGISTRY_CORE_FILES) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, DISCORD_COMMAND_REGISTRY_PATTERN, relativePath);
  }
});

test('interaction core modules consume normalized interaction input', () => {
  for (const relativePath of NORMALIZED_INTERACTION_CORE_FILES) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, RAW_INTERACTION_INPUT_PATTERN, relativePath);
  }
});

test('runtime core modules use message delivery instead of raw reactions or edits', () => {
  for (const relativePath of MESSAGE_DELIVERY_CORE_FILES) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, RAW_MESSAGE_DELIVERY_PATTERN, relativePath);
  }
});
