import { createLarkAccessPolicy } from './access-policy.js';
import { createLarkEntryHandlers } from '../../lark-entry-handlers.js';
import { createLarkLifecycle } from '../../lark-lifecycle.js';
import {
  LARK_PLATFORM_CAPABILITIES,
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
import { assertCommandRegistryRenderer } from '../command-registry.js';
import { assertCommandViewRenderer } from '../command-view.js';
import { assertConversationPresentation } from '../conversation-presentation.js';
import { assertConversationSecurityResolver } from '../conversation-security.js';
import { assertConversationSpawn } from '../conversation-spawn.js';
import { assertInboundEventNormalizer } from '../inbound-event.js';
import { assertInteractionResponse } from '../interaction-response.js';
import { assertMessageDelivery } from '../message-delivery.js';
import { assertNotificationDelivery } from '../notification-delivery.js';
import { assertTextPresentation } from '../text-presentation.js';
import { createLarkCommandRegistryRenderer } from './command-registry-renderer.js';
import { createLarkCommandViewRenderer } from './command-view-renderer.js';
import { createLarkConversationPresentation } from './conversation-presentation.js';
import { createLarkConversationSecurity } from './conversation-security.js';
import { createLarkConversationSpawn } from './conversation-spawn.js';
import { createLarkInboundEventNormalizer } from './inbound-event.js';
import { createLarkInteractionResponse } from './interaction-response.js';
import { createLarkMessageDelivery } from './message-delivery.js';
import { createLarkNotificationDelivery } from './notification-delivery.js';
import { createLarkTextPresentation } from './text-presentation.js';

export function createLarkPlatformAdapter({
  capabilities = LARK_PLATFORM_CAPABILITIES,
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
    createAccessPolicy = createLarkAccessPolicy,
    createEntryHandlers = createLarkEntryHandlers,
    createLifecycle = createLarkLifecycle,
    createMessageDelivery = createLarkMessageDelivery,
    createNotificationDelivery = createLarkNotificationDelivery,
    createEventNormalizer = createLarkInboundEventNormalizer,
    createCommandRegistryRenderer = createLarkCommandRegistryRenderer,
    createCommandViewRenderer = createLarkCommandViewRenderer,
    createInteractionResponse = createLarkInteractionResponse,
    createConversationSpawn = createLarkConversationSpawn,
    createConversationPresentation = createLarkConversationPresentation,
    createConversationSecurity = createLarkConversationSecurity,
    createTextPresentation = createLarkTextPresentation,
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
    createCommandRegistryPolicy({ capabilities: resolvedCapabilities, renderer: baseCommandRegistryRenderer }),
  );
  const baseCommandViewRenderer = assertCommandViewRenderer(
    commandViewRenderer || createCommandViewRenderer(commandViewRendererOptions),
  );
  const resolvedCommandViewRenderer = assertCommandViewRenderer(
    createCommandViewPolicy({ capabilities: resolvedCapabilities, renderer: baseCommandViewRenderer }),
  );
  const baseMessageDelivery = assertMessageDelivery(
    messageDelivery || createMessageDelivery({
      commandViewRenderer: resolvedCommandViewRenderer,
      ...messageDeliveryOptions,
    }),
  );
  const resolvedMessageDelivery = assertMessageDelivery(
    createMessageDeliveryPolicy({ capabilities: resolvedCapabilities, messageDelivery: baseMessageDelivery }),
  );
  const baseEventNormalizer = assertInboundEventNormalizer(
    eventNormalizer || createEventNormalizer({
      resolveMessageTarget: resolvedMessageDelivery.resolveMessageTarget,
      ...eventNormalizerOptions,
    }),
  );
  const resolvedEventNormalizer = assertInboundEventNormalizer(
    createEventNormalizerPolicy({ capabilities: resolvedCapabilities, eventNormalizer: baseEventNormalizer }),
  );
  const resolvedNotificationDelivery = assertNotificationDelivery(
    notificationDelivery || createNotificationDelivery(notificationDeliveryOptions),
  );
  const baseInteractionResponse = assertInteractionResponse(
    interactionResponse || createInteractionResponse({
      messageDelivery: resolvedMessageDelivery,
      ...interactionResponseOptions,
    }),
  );
  const resolvedInteractionResponse = assertInteractionResponse(
    createInteractionResponsePolicy({ capabilities: resolvedCapabilities, interactionResponse: baseInteractionResponse }),
  );
  const resolvedConversationSpawn = assertConversationSpawn(
    conversationSpawn || createConversationSpawn({
      messageDelivery: resolvedMessageDelivery,
      ...conversationSpawnOptions,
    }),
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
    id: 'lark',
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
