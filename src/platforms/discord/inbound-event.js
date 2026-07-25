import { doesMessageTargetBot } from '../../discord-message-input.js';
import {
  assertInboundEventNormalizer,
  assertInboundInteractionEvent,
  assertInboundMessageEvent,
} from '../inbound-event.js';

function normalizeOptionalId(value) {
  return String(value || '').trim() || null;
}

function normalizeAttachments(attachments) {
  if (!attachments) return [];
  const values = typeof attachments.values === 'function'
    ? [...attachments.values()]
    : Array.isArray(attachments)
      ? attachments
      : [];

  return values.map((attachment, index) => ({
    id: normalizeOptionalId(attachment?.id) || `attachment-${index + 1}`,
    name: String(attachment?.name || 'unnamed-file'),
    mimeType: normalizeOptionalId(attachment?.contentType),
    sizeBytes: Number.isFinite(attachment?.size) ? attachment.size : null,
    url: normalizeOptionalId(attachment?.url || attachment?.proxyURL),
    raw: attachment,
  }));
}

export function createDiscordInboundEventNormalizer() {
  function normalizeMessage(message, { botUserId = null } = {}) {
    const rawText = String(message?.content || '');
    const normalizedBotUserId = normalizeOptionalId(botUserId);
    const text = normalizedBotUserId
      ? rawText.replace(new RegExp(`<@!?${normalizedBotUserId}>`, 'g'), '').trim()
      : rawText.trim();
    const channel = message?.channel || null;
    const isThread = Boolean(channel?.isThread?.());

    return assertInboundMessageEvent({
      type: 'message',
      platformId: 'discord',
      id: String(message?.id || '').trim(),
      actor: {
        id: String(message?.author?.id || '').trim(),
        displayName: String(
          message?.author?.tag
          || message?.author?.globalName
          || message?.author?.username
          || message?.author?.id
          || '',
        ).trim(),
        isBot: Boolean(message?.author?.bot),
        raw: message?.author || null,
      },
      conversation: {
        id: String(channel?.id || '').trim(),
        tenantId: normalizeOptionalId(
          message?.guildId
          || channel?.guild?.id
          || channel?.parent?.guild?.id,
        ),
        parentId: isThread ? normalizeOptionalId(channel?.parentId) : null,
        isThread,
        raw: channel,
      },
      rawText,
      text,
      attachments: normalizeAttachments(message?.attachments),
      replyToMessageId: normalizeOptionalId(
        message?.reference?.messageId
        || message?.reference?.message_id
        || message?.reference?.message?.id,
      ),
      isSystem: Boolean(message?.system),
      targetsBot: Boolean(
        normalizedBotUserId
        && doesMessageTargetBot(message, normalizedBotUserId)
      ),
      client: message?.client || channel?.client || null,
      responseTarget: message,
      raw: message,
    });
  }

  function normalizeInteraction(interaction) {
    const channel = interaction?.channel || null;
    const isThread = Boolean(channel?.isThread?.());
    const kind = interaction?.isChatInputCommand?.()
      ? 'command'
      : interaction?.isButton?.()
        ? 'button'
        : interaction?.isStringSelectMenu?.()
          ? 'select'
          : interaction?.isModalSubmit?.()
            ? 'modal'
            : 'unknown';

    const command = kind === 'command'
      ? {
        name: String(interaction?.commandName || '').trim(),
        getOption(name) {
          try {
            return interaction?.options?.getString?.(name) ?? null;
          } catch {
            return null;
          }
        },
      }
      : null;
    const component = kind === 'button' || kind === 'select'
      ? {
        id: String(interaction?.customId || '').trim(),
        values: Array.isArray(interaction?.values)
          ? interaction.values.map((value) => String(value))
          : [],
      }
      : null;
    const modal = kind === 'modal'
      ? {
        id: String(interaction?.customId || '').trim(),
        getField(name) {
          try {
            return interaction?.fields?.getTextInputValue?.(name) ?? '';
          } catch {
            return '';
          }
        },
      }
      : null;

    return assertInboundInteractionEvent({
      type: 'interaction',
      kind,
      platformId: 'discord',
      id: String(interaction?.id || '').trim(),
      actor: {
        id: String(interaction?.user?.id || '').trim(),
        displayName: String(
          interaction?.user?.tag
          || interaction?.user?.globalName
          || interaction?.user?.username
          || interaction?.user?.id
          || '',
        ).trim(),
        raw: interaction?.user || null,
      },
      conversation: {
        id: String(interaction?.channelId || channel?.id || '').trim(),
        tenantId: normalizeOptionalId(
          interaction?.guildId
          || channel?.guild?.id
          || channel?.parent?.guild?.id,
        ),
        parentId: isThread ? normalizeOptionalId(channel?.parentId) : null,
        isThread,
        raw: channel,
      },
      command,
      component,
      modal,
      client: interaction?.client || channel?.client || null,
      responseTarget: interaction,
      raw: interaction,
    });
  }

  return assertInboundEventNormalizer({
    normalizeMessage,
    normalizeInteraction,
  });
}
