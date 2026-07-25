import {
  DISCORD_PLATFORM_CAPABILITIES,
  assertPlatformCapabilities,
} from '../capabilities.js';
import {
  createCapabilityAwareCommandRegistryRenderer,
  createCapabilityAwareCommandViewRenderer,
  createCapabilityAwareInteractionResponse,
} from '../command-ui-policy.js';
import {
  createCapabilityAwareMessageDelivery,
} from '../runtime-capability-policy.js';
import { assertCommandRegistryRenderer } from '../command-registry.js';
import { assertCommandViewRenderer } from '../command-view.js';
import { assertConversationPresentation } from '../conversation-presentation.js';
import { assertConversationSecurityResolver } from '../conversation-security.js';
import { assertConversationSpawn } from '../conversation-spawn.js';
import { assertPlatformFoundation } from '../foundation.js';
import { assertInteractionResponse } from '../interaction-response.js';
import { assertMessageDelivery } from '../message-delivery.js';
import { assertNotificationDelivery } from '../notification-delivery.js';
import { assertTextPresentation } from '../text-presentation.js';
import { createDiscordPlatformAdapter } from './adapter.js';
import { createDiscordCommandRegistryRenderer } from './command-registry-renderer.js';
import { createDiscordCommandViewRenderer } from './command-view-renderer.js';
import { createDiscordConversationPresentation } from './conversation-presentation.js';
import { createDiscordConversationSecurity } from './conversation-security.js';
import { createDiscordConversationSpawn } from './conversation-spawn.js';
import { createDiscordInteractionResponse } from './interaction-response.js';
import { createDiscordMessageDelivery } from './message-delivery.js';
import { createDiscordNotificationDelivery } from './notification-delivery.js';
import { createDiscordTextPresentation } from './text-presentation.js';

export function createDiscordPlatformFoundation({
  capabilities = DISCORD_PLATFORM_CAPABILITIES,
  commandRegistryRendererOptions = {},
  commandViewRendererOptions = {},
  interactionResponseOptions = {},
  messageDeliveryOptions = {},
  notificationDeliveryOptions = {},
  conversationSpawnOptions = {},
  conversationPresentationOptions = {},
  conversationSecurityOptions = {},
  textPresentationOptions = {},
  factories = {},
} = {}) {
  const {
    createAdapter = createDiscordPlatformAdapter,
    createCommandRegistryRenderer = createDiscordCommandRegistryRenderer,
    createCommandViewRenderer = createDiscordCommandViewRenderer,
    createInteractionResponse = createDiscordInteractionResponse,
    createMessageDelivery = createDiscordMessageDelivery,
    createNotificationDelivery = createDiscordNotificationDelivery,
    createConversationSpawn = createDiscordConversationSpawn,
    createConversationPresentation = createDiscordConversationPresentation,
    createConversationSecurity = createDiscordConversationSecurity,
    createTextPresentation = createDiscordTextPresentation,
    createCommandRegistryPolicy = createCapabilityAwareCommandRegistryRenderer,
    createCommandViewPolicy = createCapabilityAwareCommandViewRenderer,
    createInteractionResponsePolicy = createCapabilityAwareInteractionResponse,
    createMessageDeliveryPolicy = createCapabilityAwareMessageDelivery,
  } = factories;

  const resolvedCapabilities = assertPlatformCapabilities(capabilities);
  const baseCommandRegistryRenderer = assertCommandRegistryRenderer(
    createCommandRegistryRenderer(commandRegistryRendererOptions),
  );
  const commandRegistryRenderer = assertCommandRegistryRenderer(
    createCommandRegistryPolicy({
      capabilities: resolvedCapabilities,
      renderer: baseCommandRegistryRenderer,
    }),
  );
  const baseCommandViewRenderer = assertCommandViewRenderer(
    createCommandViewRenderer(commandViewRendererOptions),
  );
  const commandViewRenderer = assertCommandViewRenderer(
    createCommandViewPolicy({
      capabilities: resolvedCapabilities,
      renderer: baseCommandViewRenderer,
    }),
  );
  const baseMessageDelivery = assertMessageDelivery(
    createMessageDelivery({
      commandViewRenderer,
      ...messageDeliveryOptions,
    }),
  );
  const messageDelivery = assertMessageDelivery(
    createMessageDeliveryPolicy({
      capabilities: resolvedCapabilities,
      messageDelivery: baseMessageDelivery,
    }),
  );
  const notificationDelivery = assertNotificationDelivery(
    createNotificationDelivery(notificationDeliveryOptions),
  );
  const baseInteractionResponse = assertInteractionResponse(
    createInteractionResponse({
      commandViewRenderer,
      ...interactionResponseOptions,
    }),
  );
  const interactionResponse = assertInteractionResponse(
    createInteractionResponsePolicy({
      capabilities: resolvedCapabilities,
      interactionResponse: baseInteractionResponse,
    }),
  );
  const conversationSpawn = assertConversationSpawn(
    createConversationSpawn(conversationSpawnOptions),
  );
  const conversationPresentation = assertConversationPresentation(
    createConversationPresentation(conversationPresentationOptions),
  );
  const conversationSecurity = assertConversationSecurityResolver(
    createConversationSecurity(conversationSecurityOptions),
  );
  const textPresentation = assertTextPresentation(
    createTextPresentation(textPresentationOptions),
  );

  return assertPlatformFoundation({
    id: 'discord',
    capabilities: resolvedCapabilities,
    commandRegistryRenderer,
    commandViewRenderer,
    interactionResponse,
    messageDelivery,
    notificationDelivery,
    conversationSpawn,
    conversationPresentation,
    conversationSecurity,
    textPresentation,
    createAdapter(options = {}) {
      return createAdapter({
        ...options,
        capabilities: resolvedCapabilities,
        commandRegistryRenderer,
        commandViewRenderer,
        interactionResponse,
        messageDelivery,
        notificationDelivery,
        conversationSpawn,
        conversationPresentation,
        conversationSecurity,
        textPresentation,
      });
    },
  });
}
