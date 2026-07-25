import { assertCommandRegistryRenderer } from '../command-registry.js';

export async function registerDiscordCommands({
  client,
  REST,
  Routes,
  discordToken,
  restProxyAgent = null,
  commandSpecs = [],
  commandRegistryRenderer,
  logger = console,
} = {}) {
  try {
    const renderer = assertCommandRegistryRenderer(commandRegistryRenderer);
    const rest = new REST({ version: '10' }).setToken(discordToken);
    if (restProxyAgent) rest.setAgent(restProxyAgent);
    const body = renderer.renderCommands(commandSpecs).map((command) => command.toJSON());

    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body });
      logger.log(`📝 Registered ${body.length} slash commands in guild: ${guild.name}`);
    }
  } catch (err) {
    logger.error('Failed to register slash commands:', err);
  }
}
