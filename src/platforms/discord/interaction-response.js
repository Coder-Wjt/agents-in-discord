import {
  createCommandMessageView,
  assertCommandViewRenderer,
} from '../command-view.js';
import { assertInteractionResponse } from '../interaction-response.js';

function defaultDescribeInteraction(interaction) {
  if (!interaction) return 'interaction';
  const target = interaction.responseTarget || interaction;
  const commandName = String(interaction.command?.name || target.commandName || '').trim();
  if (commandName) return `interaction:${commandName}`;
  const customId = String(interaction.component?.id || interaction.modal?.id || target.customId || '').trim();
  if (customId) return `interaction:${customId}`;
  return `interaction:${interaction.kind || target.type || 'unknown'}`;
}

function resolveInteractionTarget(interaction) {
  return interaction?.responseTarget || interaction;
}

function normalizeMessageView(value) {
  if (typeof value === 'string') {
    return createCommandMessageView({ content: value });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Interaction message response must be a command message view.');
  }
  if (value.type && value.type !== 'message') {
    throw new TypeError(`Interaction message response must be a message view, received ${value.type}.`);
  }
  if ('flags' in value || 'components' in value) {
    throw new TypeError('Interaction message response cannot contain platform-native flags or components.');
  }
  return createCommandMessageView({
    content: value.content,
    rows: value.rows,
    visibility: value.visibility,
    fallbackText: value.fallbackText,
  });
}

function normalizeModalView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'modal') {
    throw new TypeError('Interaction modal response must be a command modal view.');
  }
  return value;
}

export function createDiscordInteractionResponse({
  commandViewRenderer,
  withDiscordNetworkRetry = async (operation) => operation(),
  describeInteraction = defaultDescribeInteraction,
  logger = console,
} = {}) {
  const renderer = assertCommandViewRenderer(commandViewRenderer);

  function renderMessage(value) {
    return renderer.renderMessage(normalizeMessageView(value));
  }

  async function run(interaction, operation, label) {
    return withDiscordNetworkRetry(operation, {
      logger,
      label: `${describeInteraction(interaction)} ${label}`,
      maxAttempts: 3,
      baseDelayMs: 250,
    });
  }

  async function respond(interaction, view) {
    const target = resolveInteractionTarget(interaction);
    const payload = renderMessage(view);
    if (target?.deferred && !target?.replied) {
      const { flags: _ignoredFlags, ...editPayload } = payload;
      return run(interaction, () => target.editReply(editPayload), 'editReply');
    }
    if (target?.replied) {
      return run(interaction, () => target.followUp(payload), 'followUp');
    }
    return run(interaction, () => target.reply(payload), 'reply');
  }

  async function update(interaction, view) {
    const target = resolveInteractionTarget(interaction);
    const { flags: _ignoredFlags, ...payload } = renderMessage(view);
    return run(interaction, () => target.update(payload), 'update');
  }

  async function showModal(interaction, view) {
    const target = resolveInteractionTarget(interaction);
    const payload = renderer.renderModal(normalizeModalView(view));
    return run(interaction, () => target.showModal(payload), 'showModal');
  }

  async function defer(interaction, { visibility = 'ephemeral' } = {}) {
    const target = resolveInteractionTarget(interaction);
    if (!['public', 'ephemeral'].includes(visibility)) {
      throw new TypeError(`Unsupported interaction defer visibility: ${visibility}`);
    }
    const payload = visibility === 'ephemeral' ? { flags: 64 } : {};
    return withDiscordNetworkRetry(
      () => target.deferReply(payload),
      {
        logger,
        label: `${describeInteraction(interaction)} deferReply`,
        maxAttempts: 3,
        baseDelayMs: 75,
      },
    );
  }

  return assertInteractionResponse({
    respond,
    update,
    showModal,
    defer,
  });
}
