import { buildCommandSpecs } from './command-spec.js';
import {
  createDiscordCommandRegistryRenderer,
  formatDiscordCommandName,
  normalizeDiscordCommandName,
} from './platforms/discord/command-registry-renderer.js';
import { registerDiscordCommands } from './platforms/discord/command-registration.js';
import { createDiscordConversationPresentation } from './platforms/discord/conversation-presentation.js';

export function slashName(base, slashPrefix = '') {
  return formatDiscordCommandName(base, slashPrefix);
}

export function normalizeSlashCommandName(name, slashPrefix = '') {
  return normalizeDiscordCommandName(name, slashPrefix);
}

export function slashRef(base, slashPrefix = '') {
  return `/${slashName(base, slashPrefix)}`;
}

export function buildSlashCommands({ SlashCommandBuilder, slashPrefix = '', botProvider = null } = {}) {
  return createDiscordCommandRegistryRenderer({ SlashCommandBuilder, slashPrefix })
    .renderCommands(buildCommandSpecs({
      botProvider,
      conversationPresentation: createDiscordConversationPresentation(),
    }));
}

export async function registerSlashCommands({
  slashCommands = [],
  commandSpecs = null,
  commandRegistryRenderer = null,
  ...options
} = {}) {
  const renderer = commandRegistryRenderer || {
    renderCommands: () => slashCommands,
    formatCommandName: (name) => name,
    normalizeCommandName: (name) => name,
    formatCommandReference: (name) => `/${name}`,
  };
  return registerDiscordCommands({
    ...options,
    commandSpecs: commandSpecs || [],
    commandRegistryRenderer: renderer,
  });
}
