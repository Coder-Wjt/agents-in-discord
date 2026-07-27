import { createCommandMessageView } from '../command-view.js';
import { assertInteractionResponse } from '../interaction-response.js';
import { createLarkPrivateConversationContext } from './private-context.js';

function isEphemeralView(view) {
  return String(view?.visibility || '').trim().toLowerCase() === 'ephemeral';
}

function getActorId(interaction) {
  return String(
    interaction?.actor?.id
    || interaction?.actorId
    || interaction?.operator?.openId
    || interaction?.operator?.userId
    || '',
  ).trim() || null;
}

function isDirectInteraction(interaction) {
  const target = interaction?.responseTarget || interaction;
  const raw = interaction?.conversation?.raw || {};
  if (target?.contextConversation) return true;
  return String(target?.chatType || raw?.chatType || '').trim().toLowerCase() === 'p2p';
}

function createPrivateTarget(interaction) {
  const userId = getActorId(interaction);
  const contextConversation = createLarkPrivateConversationContext(interaction?.conversation);
  if (!userId || !contextConversation) return null;
  return {
    platformId: 'lark',
    userId,
    tenantId: contextConversation.tenantId,
    contextConversation,
  };
}

export function createLarkInteractionResponse({ messageDelivery } = {}) {
  async function respond(interaction, view) {
    const target = interaction?.responseTarget || interaction;
    if (interaction?.kind === 'modal' && target?.messageId) {
      return messageDelivery.edit(target, view);
    }
    if (isEphemeralView(view) && !isDirectInteraction(interaction)) {
      const privateTarget = createPrivateTarget(interaction);
      if (privateTarget) return messageDelivery.send(privateTarget, view);
    }
    return messageDelivery.reply(interaction, view);
  }

  async function update(interaction, view) {
    const target = interaction?.responseTarget || interaction;
    if (target?.messageId) return messageDelivery.edit(target, view);
    return respond(interaction, view);
  }

  async function showModal(interaction, view) {
    const target = interaction?.responseTarget || interaction;
    if (target?.messageId) return messageDelivery.edit(target, view);
    return messageDelivery.reply(interaction, view || createCommandMessageView({ content: 'Form' }));
  }

  return assertInteractionResponse({
    respond,
    update,
    showModal,
    defer: async () => {},
  });
}
