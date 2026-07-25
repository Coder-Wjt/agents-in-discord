export const INTERACTION_RESPONSE_METHODS = Object.freeze([
  'respond',
  'update',
  'showModal',
  'defer',
]);

export function assertInteractionResponse(interactionResponse) {
  if (!interactionResponse || typeof interactionResponse !== 'object' || Array.isArray(interactionResponse)) {
    throw new TypeError('Interaction response port must be an object.');
  }

  for (const method of INTERACTION_RESPONSE_METHODS) {
    if (typeof interactionResponse[method] !== 'function') {
      throw new TypeError(`Interaction response port must provide ${method}().`);
    }
  }

  return interactionResponse;
}
