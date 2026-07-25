import { PLATFORM_CAPABILITY_NAMES } from './capabilities.js';

export const COMMAND_OPTION_TYPES = Object.freeze(['string']);

export const COMMAND_REGISTRY_RENDERER_METHODS = Object.freeze([
  'renderCommands',
  'formatCommandName',
  'normalizeCommandName',
  'formatCommandReference',
]);

function requireText(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${name} must be a non-empty string.`);
  return normalized;
}

export function createCommandOption({
  type = 'string',
  name,
  description,
  required = false,
  choices = [],
} = {}) {
  if (!COMMAND_OPTION_TYPES.includes(type)) {
    throw new TypeError(`Unsupported command option type: ${type}`);
  }
  return {
    type,
    name: requireText(name, 'command option name'),
    description: requireText(description, 'command option description'),
    required: Boolean(required),
    choices: (choices || []).map((choice) => ({
      name: requireText(choice?.name, 'command option choice name'),
      value: requireText(choice?.value, 'command option choice value'),
    })),
  };
}

export function createCommandSpec({
  name,
  description,
  aliases = [],
  aliasDescriptions = {},
  options = [],
  requiredCapabilities = [],
} = {}) {
  const normalizedRequiredCapabilities = (requiredCapabilities || []).map((capability) => {
    const normalized = requireText(capability, 'required capability');
    if (!PLATFORM_CAPABILITY_NAMES.includes(normalized)) {
      throw new TypeError(`Unsupported required platform capability: ${normalized}`);
    }
    return normalized;
  });
  return {
    name: requireText(name, 'command name'),
    description: requireText(description, 'command description'),
    aliases: (aliases || []).map((alias) => requireText(alias, 'command alias')),
    aliasDescriptions: Object.freeze({ ...(aliasDescriptions || {}) }),
    options: (options || []).map((option) => createCommandOption(option)),
    ...(normalizedRequiredCapabilities.length
      ? { requiredCapabilities: Object.freeze([...new Set(normalizedRequiredCapabilities)]) }
      : {}),
  };
}

export function assertCommandRegistryRenderer(renderer) {
  if (!renderer || typeof renderer !== 'object' || Array.isArray(renderer)) {
    throw new TypeError('Command registry renderer must be an object.');
  }
  for (const method of COMMAND_REGISTRY_RENDERER_METHODS) {
    if (typeof renderer[method] !== 'function') {
      throw new TypeError(`Command registry renderer must provide ${method}().`);
    }
  }
  return renderer;
}
