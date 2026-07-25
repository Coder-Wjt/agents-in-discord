import { assertCommandRegistryRenderer } from '../command-registry.js';

export function formatDiscordCommandName(base, slashPrefix = '') {
  const command = String(base || '').trim().toLowerCase();
  if (!slashPrefix) return command;

  const prefix = `${slashPrefix}_`;
  const maxBaseLength = Math.max(1, 32 - prefix.length);
  return `${prefix}${command.slice(0, maxBaseLength)}`;
}

export function normalizeDiscordCommandName(name, slashPrefix = '') {
  const raw = String(name || '').trim().toLowerCase();
  if (!slashPrefix) return raw;
  const prefix = `${slashPrefix}_`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

export function createDiscordCommandRegistryRenderer({
  SlashCommandBuilder = null,
  slashPrefix = '',
} = {}) {
  function formatCommandName(base) {
    return formatDiscordCommandName(base, slashPrefix);
  }

  function normalizeCommandName(name) {
    return normalizeDiscordCommandName(name, slashPrefix);
  }

  function formatCommandReference(base) {
    return `/${formatCommandName(base)}`;
  }

  function renderOption(builder, option) {
    if (option.type !== 'string') {
      throw new TypeError(`Discord command renderer does not support option type: ${option.type}`);
    }
    return builder.addStringOption((target) => {
      target
        .setName(option.name)
        .setDescription(option.description)
        .setRequired(option.required);
      if (option.choices.length) target.addChoices(...option.choices);
      return target;
    });
  }

  function renderCommand(spec, commandName) {
    if (typeof SlashCommandBuilder !== 'function') {
      throw new TypeError('Discord command registry renderer requires SlashCommandBuilder to render commands.');
    }
    let builder = new SlashCommandBuilder()
      .setName(formatCommandName(commandName))
      .setDescription(spec.aliasDescriptions?.[commandName] || spec.description);
    for (const option of spec.options || []) {
      builder = renderOption(builder, option);
    }
    return builder;
  }

  function renderCommands(specs = []) {
    return specs.flatMap((spec) => [spec.name, ...(spec.aliases || [])]
      .map((commandName) => renderCommand(spec, commandName)));
  }

  return assertCommandRegistryRenderer({
    renderCommands,
    formatCommandName,
    normalizeCommandName,
    formatCommandReference,
  });
}
