import { createDiscordAccessPolicy } from '../../discord-access-policy.js';
import { createDiscordEntryHandlers } from '../../discord-entry-handlers.js';
import { createDiscordLifecycle } from '../../discord-lifecycle.js';
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
  createCapabilityAwareInboundEventNormalizer,
  createCapabilityAwareMessageDelivery,
} from '../runtime-capability-policy.js';
import { assertPlatformAdapter } from '../contracts.js';
import { assertMessageDelivery } from '../message-delivery.js';
import { assertInboundEventNormalizer } from '../inbound-event.js';
import { createDiscordInboundEventNormalizer } from './inbound-event.js';
import { createDiscordMessageDelivery } from './message-delivery.js';
import { assertNotificationDelivery } from '../notification-delivery.js';
import { createDiscordNotificationDelivery } from './notification-delivery.js';
import { assertCommandViewRenderer } from '../command-view.js';
import { createDiscordCommandViewRenderer } from './command-view-renderer.js';
import { assertCommandRegistryRenderer } from '../command-registry.js';
import { createDiscordCommandRegistryRenderer } from './command-registry-renderer.js';
import { assertInteractionResponse } from '../interaction-response.js';
import { createDiscordInteractionResponse } from './interaction-response.js';
import { assertConversationSpawn } from '../conversation-spawn.js';
import { createDiscordConversationSpawn } from './conversation-spawn.js';
import { assertConversationPresentation } from '../conversation-presentation.js';
import { createDiscordConversationPresentation } from './conversation-presentation.js';
import { assertConversationSecurityResolver } from '../conversation-security.js';
import { createDiscordConversationSecurity } from './conversation-security.js';
import { assertTextPresentation } from '../text-presentation.js';
import { createDiscordTextPresentation } from './text-presentation.js';

export function createDiscordPlatformAdapter({
  capabilities = DISCORD_PLATFORM_CAPABILITIES,
  commandRegistryRenderer = null,
  commandRegistryRendererOptions = {},
  commandViewRenderer = null,
  commandViewRendererOptions = {},
  interactionResponse = null,
  interactionResponseOptions = {},
  eventNormalizer = null,
  eventNormalizerOptions = {},
  messageDelivery = null,
  messageDeliveryOptions = {},
  notificationDelivery = null,
  notificationDeliveryOptions = {},
  conversationSpawn = null,
  conversationSpawnOptions = {},
  conversationPresentation = null,
  conversationPresentationOptions = {},
  conversationSecurity = null,
  conversationSecurityOptions = {},
  textPresentation = null,
  textPresentationOptions = {},
  accessPolicyOptions = {},
  entryHandlerOptions = {},
  lifecycleOptions = {},
  factories = {},
} = {}) {
  const {
    createAccessPolicy = createDiscordAccessPolicy,
    createEntryHandlers = createDiscordEntryHandlers,
    createLifecycle = createDiscordLifecycle,
    createMessageDelivery = createDiscordMessageDelivery,
    createNotificationDelivery = createDiscordNotificationDelivery,
    createEventNormalizer = createDiscordInboundEventNormalizer,
    createCommandRegistryRenderer = createDiscordCommandRegistryRenderer,
    createCommandViewRenderer = createDiscordCommandViewRenderer,
    createInteractionResponse = createDiscordInteractionResponse,
    createConversationSpawn = createDiscordConversationSpawn,
    createConversationPresentation = createDiscordConversationPresentation,
    createConversationSecurity = createDiscordConversationSecurity,
    createTextPresentation = createDiscordTextPresentation,
    createCommandRegistryPolicy = createCapabilityAwareCommandRegistryRenderer,
    createCommandViewPolicy = createCapabilityAwareCommandViewRenderer,
    createInteractionResponsePolicy = createCapabilityAwareInteractionResponse,
    createEventNormalizerPolicy = createCapabilityAwareInboundEventNormalizer,
    createMessageDeliveryPolicy = createCapabilityAwareMessageDelivery,
  } = factories;

  const resolvedCapabilities = assertPlatformCapabilities(capabilities);
  const baseCommandRegistryRenderer = assertCommandRegistryRenderer(
    commandRegistryRenderer || createCommandRegistryRenderer(commandRegistryRendererOptions),
  );
  const resolvedCommandRegistryRenderer = assertCommandRegistryRenderer(
    createCommandRegistryPolicy({
      capabilities: resolvedCapabilities,
      renderer: baseCommandRegistryRenderer,
    }),
  );
  const baseCommandViewRenderer = assertCommandViewRenderer(
    commandViewRenderer || createCommandViewRenderer(commandViewRendererOptions),
  );
  const resolvedCommandViewRenderer = assertCommandViewRenderer(
    createCommandViewPolicy({
      capabilities: resolvedCapabilities,
      renderer: baseCommandViewRenderer,
    }),
  );
  const baseEventNormalizer = assertInboundEventNormalizer(
    eventNormalizer || createEventNormalizer(eventNormalizerOptions),
  );
  const resolvedEventNormalizer = assertInboundEventNormalizer(
    createEventNormalizerPolicy({
      capabilities: resolvedCapabilities,
      eventNormalizer: baseEventNormalizer,
    }),
  );
  const baseMessageDelivery = assertMessageDelivery(
    messageDelivery || createMessageDelivery({
      commandViewRenderer: resolvedCommandViewRenderer,
      ...messageDeliveryOptions,
    }),
  );
  const resolvedMessageDelivery = assertMessageDelivery(
    createMessageDeliveryPolicy({
      capabilities: resolvedCapabilities,
      messageDelivery: baseMessageDelivery,
    }),
  );
  const resolvedNotificationDelivery = assertNotificationDelivery(
    notificationDelivery || createNotificationDelivery(notificationDeliveryOptions),
  );
  const baseInteractionResponse = assertInteractionResponse(
    interactionResponse || createInteractionResponse({
      commandViewRenderer: resolvedCommandViewRenderer,
      ...interactionResponseOptions,
    }),
  );
  const resolvedInteractionResponse = assertInteractionResponse(
    createInteractionResponsePolicy({
      capabilities: resolvedCapabilities,
      interactionResponse: baseInteractionResponse,
    }),
  );
  const resolvedConversationSpawn = assertConversationSpawn(
    conversationSpawn || createConversationSpawn(conversationSpawnOptions),
  );
  const resolvedConversationPresentation = assertConversationPresentation(
    conversationPresentation || createConversationPresentation(conversationPresentationOptions),
  );
  const resolvedConversationSecurity = assertConversationSecurityResolver(
    conversationSecurity || createConversationSecurity(conversationSecurityOptions),
  );
  const resolvedTextPresentation = assertTextPresentation(
    textPresentation || createTextPresentation(textPresentationOptions),
  );
  const accessPolicy = createAccessPolicy(accessPolicyOptions);
  const entryHandlers = createEntryHandlers({
    ...entryHandlerOptions,
    accessPolicy,
    platformCapabilities: resolvedCapabilities,
    commandRegistryRenderer: resolvedCommandRegistryRenderer,
    interactionResponse: resolvedInteractionResponse,
    messageDelivery: resolvedMessageDelivery,
    conversationSpawn: resolvedConversationSpawn,
    normalizeInteractionEvent: resolvedEventNormalizer.normalizeInteraction,
    normalizeMessageEvent: resolvedEventNormalizer.normalizeMessage,
  });
  const lifecycle = createLifecycle({
    ...lifecycleOptions,
    bindClientHandlers: entryHandlers.bindClientHandlers,
  });

  return assertPlatformAdapter({
    id: 'discord',
    capabilities: resolvedCapabilities,
    commandRegistryRenderer: resolvedCommandRegistryRenderer,
    commandViewRenderer: resolvedCommandViewRenderer,
    interactionResponse: resolvedInteractionResponse,
    eventNormalizer: resolvedEventNormalizer,
    messageDelivery: resolvedMessageDelivery,
    notificationDelivery: resolvedNotificationDelivery,
    conversationSpawn: resolvedConversationSpawn,
    conversationPresentation: resolvedConversationPresentation,
    conversationSecurity: resolvedConversationSecurity,
    textPresentation: resolvedTextPresentation,
    accessPolicy,
    entryHandlers,
    lifecycle,
  });
}
