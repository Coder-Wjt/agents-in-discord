import {
  LARK_PLATFORM_CAPABILITIES,
  assertPlatformCapabilities,
} from '../capabilities.js';
import {
  createCapabilityAwareCommandRegistryRenderer,
  createCapabilityAwareCommandViewRenderer,
  createCapabilityAwareInteractionResponse,
} from '../command-ui-policy.js';
import { createCapabilityAwareMessageDelivery } from '../runtime-capability-policy.js';
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
import { createLarkPlatformAdapter } from './adapter.js';
import { createLarkCommandRegistryRenderer } from './command-registry-renderer.js';
import { createLarkCommandViewRenderer } from './command-view-renderer.js';
import { createLarkConversationPresentation } from './conversation-presentation.js';
import { createLarkConversationSecurity } from './conversation-security.js';
import { createLarkConversationSpawn } from './conversation-spawn.js';
import { createLarkInteractionResponse } from './interaction-response.js';
import { createLarkMessageDelivery } from './message-delivery.js';
import { createLarkNotificationDelivery } from './notification-delivery.js';
import { createLarkTextPresentation } from './text-presentation.js';

export function createLarkPlatformFoundation({
  capabilities = LARK_PLATFORM_CAPABILITIES,
  commandRegistryRendererOptions = {},
  commandViewRendererOptions = {},
  interactionResponseOptions = {},
  eventNormalizerOptions = {},
  messageDeliveryOptions = {},
  notificationDeliveryOptions = {},
  conversationSpawnOptions = {},
  conversationPresentationOptions = {},
  conversationSecurityOptions = {},
  textPresentationOptions = {},
  factories = {},
} = {}) {
  const {
    createAdapter = createLarkPlatformAdapter,
    createCommandRegistryRenderer = createLarkCommandRegistryRenderer,
    createCommandViewRenderer = createLarkCommandViewRenderer,
    createInteractionResponse = createLarkInteractionResponse,
    createMessageDelivery = createLarkMessageDelivery,
    createNotificationDelivery = createLarkNotificationDelivery,
    createConversationSpawn = createLarkConversationSpawn,
    createConversationPresentation = createLarkConversationPresentation,
    createConversationSecurity = createLarkConversationSecurity,
    createTextPresentation = createLarkTextPresentation,
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
    createCommandRegistryPolicy({ capabilities: resolvedCapabilities, renderer: baseCommandRegistryRenderer }),
  );
  const baseCommandViewRenderer = assertCommandViewRenderer(
    createCommandViewRenderer(commandViewRendererOptions),
  );
  const commandViewRenderer = assertCommandViewRenderer(
    createCommandViewPolicy({ capabilities: resolvedCapabilities, renderer: baseCommandViewRenderer }),
  );
  const baseMessageDelivery = assertMessageDelivery(createMessageDelivery({
    commandViewRenderer,
    ...messageDeliveryOptions,
  }));
  const messageDelivery = assertMessageDelivery(
    createMessageDeliveryPolicy({ capabilities: resolvedCapabilities, messageDelivery: baseMessageDelivery }),
  );
  const notificationDelivery = assertNotificationDelivery(
    createNotificationDelivery(notificationDeliveryOptions),
  );
  const baseInteractionResponse = assertInteractionResponse(createInteractionResponse({
    messageDelivery,
    ...interactionResponseOptions,
  }));
  const interactionResponse = assertInteractionResponse(
    createInteractionResponsePolicy({ capabilities: resolvedCapabilities, interactionResponse: baseInteractionResponse }),
  );
  const conversationSpawn = assertConversationSpawn(createConversationSpawn({
    messageDelivery,
    ...conversationSpawnOptions,
  }));
  const conversationPresentation = assertConversationPresentation(
    createConversationPresentation(conversationPresentationOptions),
  );
  const conversationSecurity = assertConversationSecurityResolver(
    createConversationSecurity(conversationSecurityOptions),
  );
  const textPresentation = assertTextPresentation(createTextPresentation(textPresentationOptions));

  return assertPlatformFoundation({
    id: 'lark',
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
        eventNormalizerOptions: {
          resolveMessageTarget: messageDelivery.resolveMessageTarget,
          ...eventNormalizerOptions,
          ...(options.eventNormalizerOptions || {}),
        },
      });
    },
  });
}
