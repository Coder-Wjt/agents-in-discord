import { buildCommandSpecs } from './command-spec.js';
import { createLarkCommandRegistryRenderer } from './platforms/lark/command-registry-renderer.js';
import { createLarkConversationPresentation } from './platforms/lark/conversation-presentation.js';

export const LARK_SLASH_COMMAND_LIMIT = 100;
export const LARK_SLASH_COMMAND_PROVISIONING_SCOPES = Object.freeze([
  'application:app_slash_command:read',
  'application:app_slash_command:write',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeCommandName(value) {
  return normalizeText(value).toLowerCase().replace(/^\/+/, '');
}

function normalizeDescription(value) {
  if (typeof value === 'string') return normalizeText(value);
  return normalizeText(value?.default_value || value?.defaultValue);
}

export function buildLarkSlashCommandManifest({
  botProvider = null,
  slashPrefix = '',
  commandSpecs = null,
  conversationPresentation = null,
} = {}) {
  const presentation = conversationPresentation || createLarkConversationPresentation();
  const specs = commandSpecs || buildCommandSpecs({
    botProvider,
    conversationPresentation: presentation,
  });
  const renderer = createLarkCommandRegistryRenderer({ slashPrefix });
  return renderer.renderCommands(specs).map((item) => ({
    command: normalizeCommandName(item.command),
    description: normalizeDescription(item.description),
  }));
}

export function normalizeLarkSlashCommandList(payload) {
  const items = Array.isArray(payload)
    ? payload
    : payload?.data?.items || payload?.items;
  if (!Array.isArray(items)) {
    const error = new Error('Lark slash-command verification returned no command list.');
    error.code = 'lark_slash_command_response_invalid';
    throw error;
  }
  return items.map((item) => ({
    commandId: normalizeText(item?.command_id || item?.commandId) || null,
    command: normalizeCommandName(item?.command),
    description: normalizeDescription(item?.description),
  })).filter((item) => item.command);
}

export function verifyLarkSlashCommandProvisioningScopes(payload) {
  const scopes = payload?.data?.scopes;
  if (!Array.isArray(scopes)) {
    const error = new Error('Lark provisioning-scope verification returned no scope list.');
    error.code = 'lark_scope_response_invalid';
    throw error;
  }
  const granted = new Set(scopes
    .filter((scope) => (
      normalizeText(scope?.scope_type).toLowerCase() === 'tenant'
      && Number(scope?.grant_status) === 1
    ))
    .map((scope) => normalizeText(scope?.scope_name))
    .filter(Boolean));
  const missing = LARK_SLASH_COMMAND_PROVISIONING_SCOPES
    .filter((scope) => !granted.has(scope));
  return {
    ok: missing.length === 0,
    requiredCount: LARK_SLASH_COMMAND_PROVISIONING_SCOPES.length,
    grantedCount: LARK_SLASH_COMMAND_PROVISIONING_SCOPES.length - missing.length,
    missing,
  };
}

export function compareLarkSlashCommands(desiredCommands = [], actualCommands = []) {
  const desired = new Map((desiredCommands || []).map((item) => [
    normalizeCommandName(item?.command),
    {
      command: normalizeCommandName(item?.command),
      description: normalizeDescription(item?.description),
    },
  ]).filter(([name]) => name));
  const actual = new Map((actualCommands || []).map((item) => [
    normalizeCommandName(item?.command),
    {
      commandId: normalizeText(item?.commandId || item?.command_id) || null,
      command: normalizeCommandName(item?.command),
      description: normalizeDescription(item?.description),
    },
  ]).filter(([name]) => name));

  const missing = [];
  const outdated = [];
  for (const [name, expected] of desired) {
    const installed = actual.get(name);
    if (!installed) {
      missing.push(expected);
    } else if (installed.description !== expected.description) {
      outdated.push({ ...expected, commandId: installed.commandId });
    }
  }
  const extra = [...actual.values()]
    .filter((item) => !desired.has(item.command))
    .map(({ commandId: _commandId, ...item }) => item);

  return {
    ok: missing.length === 0 && outdated.length === 0,
    requiredCount: desired.size,
    installedCount: actual.size,
    matchedCount: desired.size - missing.length - outdated.length,
    missing,
    outdated,
    extra,
  };
}

export function planLarkSlashCommandSync(diff, {
  maxCommands = LARK_SLASH_COMMAND_LIMIT,
} = {}) {
  const limit = Number(maxCommands);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('Lark slash-command limit must be a positive integer.');
  }
  const installedCount = Math.max(0, Number(diff?.installedCount) || 0);
  const missing = Array.isArray(diff?.missing) ? diff.missing : [];
  const outdated = Array.isArray(diff?.outdated) ? diff.outdated : [];
  const availableSlots = Math.max(0, limit - installedCount);
  const capacityOk = missing.length <= availableSlots;
  const operations = [
    ...missing.map((item) => ({ type: 'create', ...item })),
    ...outdated.map(({ commandId: _commandId, ...item }) => ({ type: 'update', ...item })),
  ];
  return {
    capacityOk,
    maxCommands: limit,
    availableSlots,
    requiredCreateCount: missing.length,
    operationCount: operations.length,
    operations,
  };
}

export function buildLarkSlashCommandCliArgs(operation, { dryRun = false } = {}) {
  const type = normalizeText(operation?.type).toLowerCase();
  if (type !== 'create' && type !== 'update') {
    throw new TypeError(`Unsupported Lark slash-command operation: ${type || '(empty)'}.`);
  }
  const command = normalizeCommandName(operation?.command);
  const description = normalizeDescription(operation?.description);
  if (!command || !description) {
    throw new TypeError('Lark slash-command operations require a command and description.');
  }
  const args = [
    'application',
    type === 'create' ? '+slash-command-create' : '+slash-command-update',
    '--command',
    command,
    '--description',
    description,
  ];
  if (type === 'create') args.push('--force');
  args.push('--as', 'bot', '--json');
  if (dryRun) args.push('--dry-run');
  return args;
}
