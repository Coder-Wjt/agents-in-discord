import { assertPlatformCapabilities } from './capabilities.js';
import { assertCommandRegistryRenderer } from './command-registry.js';
import { assertCommandViewRenderer } from './command-view.js';
import { assertConversationPresentation } from './conversation-presentation.js';
import { assertConversationSecurityResolver } from './conversation-security.js';
import { assertConversationSpawn } from './conversation-spawn.js';
import { assertInteractionResponse } from './interaction-response.js';
import { assertMessageDelivery } from './message-delivery.js';
import { assertNotificationDelivery } from './notification-delivery.js';
import { assertTextPresentation } from './text-presentation.js';

export function assertPlatformFoundation(foundation) {
  if (!foundation || typeof foundation !== 'object' || Array.isArray(foundation)) {
    throw new TypeError('Platform foundation must be an object.');
  }
  if (typeof foundation.id !== 'string' || !foundation.id.trim()) {
    throw new TypeError('Platform foundation id must be a non-empty string.');
  }
  assertPlatformCapabilities(foundation.capabilities);
  assertCommandRegistryRenderer(foundation.commandRegistryRenderer);
  assertCommandViewRenderer(foundation.commandViewRenderer);
  assertInteractionResponse(foundation.interactionResponse);
  assertMessageDelivery(foundation.messageDelivery);
  assertNotificationDelivery(foundation.notificationDelivery);
  assertConversationSpawn(foundation.conversationSpawn);
  assertConversationPresentation(foundation.conversationPresentation);
  assertConversationSecurityResolver(foundation.conversationSecurity);
  assertTextPresentation(foundation.textPresentation);
  if (typeof foundation.createAdapter !== 'function') {
    throw new TypeError('Platform foundation must provide createAdapter().');
  }
  return foundation;
}
