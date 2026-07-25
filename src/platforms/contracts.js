import { assertPlatformCapabilities } from './capabilities.js';
import { assertInboundEventNormalizer } from './inbound-event.js';
import { assertMessageDelivery } from './message-delivery.js';
import { assertCommandRegistryRenderer } from './command-registry.js';
import { assertCommandViewRenderer } from './command-view.js';
import { assertInteractionResponse } from './interaction-response.js';
import { assertConversationSpawn } from './conversation-spawn.js';
import { assertNotificationDelivery } from './notification-delivery.js';
import { assertConversationPresentation } from './conversation-presentation.js';
import { assertConversationSecurityResolver } from './conversation-security.js';
import { assertTextPresentation } from './text-presentation.js';

const REQUIRED_ADAPTER_COMPONENTS = Object.freeze([
  'commandRegistryRenderer',
  'commandViewRenderer',
  'interactionResponse',
  'eventNormalizer',
  'messageDelivery',
  'notificationDelivery',
  'conversationSpawn',
  'conversationPresentation',
  'conversationSecurity',
  'textPresentation',
  'accessPolicy',
  'entryHandlers',
  'lifecycle',
]);

export function assertPlatformAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw new TypeError('Platform adapter must be an object.');
  }

  if (typeof adapter.id !== 'string' || !adapter.id.trim()) {
    throw new TypeError('Platform adapter id must be a non-empty string.');
  }

  try {
    assertPlatformCapabilities(adapter.capabilities);
  } catch (error) {
    throw new TypeError(`Platform adapter "${adapter.id}" must declare valid capabilities: ${error.message}`);
  }

  for (const component of REQUIRED_ADAPTER_COMPONENTS) {
    const value = adapter[component];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`Platform adapter "${adapter.id}" must provide ${component}.`);
    }
  }

  assertMessageDelivery(adapter.messageDelivery);
  assertNotificationDelivery(adapter.notificationDelivery);
  assertConversationSpawn(adapter.conversationSpawn);
  assertConversationPresentation(adapter.conversationPresentation);
  assertConversationSecurityResolver(adapter.conversationSecurity);
  assertTextPresentation(adapter.textPresentation);
  assertInboundEventNormalizer(adapter.eventNormalizer);
  assertCommandRegistryRenderer(adapter.commandRegistryRenderer);
  assertCommandViewRenderer(adapter.commandViewRenderer);
  assertInteractionResponse(adapter.interactionResponse);

  return adapter;
}
