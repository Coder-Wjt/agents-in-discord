export const PLATFORM_CAPABILITY_NAMES = Object.freeze([
  'threads',
  'slashCommands',
  'buttons',
  'selectMenus',
  'modals',
  'messageEdits',
  'reactions',
  'attachments',
]);

export function createPlatformCapabilities(overrides = {}) {
  const capabilities = Object.fromEntries(
    PLATFORM_CAPABILITY_NAMES.map((name) => [name, false]),
  );

  Object.assign(capabilities, overrides);

  for (const name of PLATFORM_CAPABILITY_NAMES) {
    if (typeof capabilities[name] !== 'boolean') {
      throw new TypeError(`Platform capability "${name}" must be a boolean.`);
    }
  }

  return Object.freeze(capabilities);
}

export function assertPlatformCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new TypeError('Platform capabilities must be an object.');
  }
  for (const name of PLATFORM_CAPABILITY_NAMES) {
    if (typeof capabilities[name] !== 'boolean') {
      throw new TypeError(`Platform capability "${name}" must be a boolean.`);
    }
  }
  return capabilities;
}

export const DISCORD_PLATFORM_CAPABILITIES = createPlatformCapabilities({
  threads: true,
  slashCommands: true,
  buttons: true,
  selectMenus: true,
  modals: true,
  messageEdits: true,
  reactions: true,
  attachments: true,
});
