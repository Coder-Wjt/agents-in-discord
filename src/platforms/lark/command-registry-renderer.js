import { assertCommandRegistryRenderer } from '../command-registry.js';

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/^[!/]+/, '');
}

export function formatLarkCommandName(base, slashPrefix = '') {
  const command = normalizeName(base);
  const prefix = normalizeName(slashPrefix);
  if (!prefix) return command.slice(0, 64);
  const maxBaseLength = Math.max(1, 64 - prefix.length - 1);
  return `${prefix}_${command.slice(0, maxBaseLength)}`;
}

export function normalizeLarkCommandName(name, slashPrefix = '') {
  const raw = normalizeName(name).replace(/@[^\s]+$/, '');
  const prefix = normalizeName(slashPrefix);
  if (!prefix) return raw;
  const marker = `${prefix}_`;
  return raw.startsWith(marker) ? raw.slice(marker.length) : raw;
}

function normalizeDescription(value) {
  return String(value || '').trim().slice(0, 100);
}

export function createLarkCommandRegistryRenderer({ slashPrefix = '' } = {}) {
  function formatCommandName(name) {
    return formatLarkCommandName(name, slashPrefix);
  }

  function normalizeCommandName(name) {
    return normalizeLarkCommandName(name, slashPrefix);
  }

  function renderCommands(specs = []) {
    return specs.flatMap((spec) => [spec.name, ...(spec.aliases || [])].map((commandName) => ({
      command: formatCommandName(commandName),
      description: normalizeDescription(spec.aliasDescriptions?.[commandName] || spec.description),
    })));
  }

  return assertCommandRegistryRenderer({
    renderCommands,
    formatCommandName,
    normalizeCommandName,
    formatCommandReference: (name) => `/${formatCommandName(name)}`,
  });
}
