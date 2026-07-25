import { renderExtraInfoTemplate } from '../../extra-info.js';

export const DISCORD_DEFAULT_EXTRA_INFO_TEMPLATE = '[Via agents-in-discord; discord_thread={thread}; parent={parent}]';

export function renderDiscordDefaultExtraInfo(values = {}) {
  return renderExtraInfoTemplate(DISCORD_DEFAULT_EXTRA_INFO_TEMPLATE, values);
}
