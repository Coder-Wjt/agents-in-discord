import test from 'node:test';
import assert from 'node:assert/strict';

import { registerDiscordCommands } from '../src/platforms/discord/command-registration.js';

test('Discord command registration renders specs once and registers the same body in every guild', async () => {
  let restInstance = null;
  class MockREST {
    constructor(options) {
      this.options = options;
      this.puts = [];
      restInstance = this;
    }

    setToken(token) {
      this.token = token;
      return this;
    }

    setAgent(agent) {
      this.agent = agent;
      return this;
    }

    async put(route, payload) {
      this.puts.push([route, payload]);
    }
  }
  const specs = [{ name: 'status' }];
  const renderCalls = [];
  const renderer = {
    renderCommands(commandSpecs) {
      renderCalls.push(commandSpecs);
      return [{ toJSON: () => ({ name: 'cx_status', description: 'Status' }) }];
    },
    formatCommandName: (name) => `cx_${name}`,
    normalizeCommandName: (name) => String(name).replace(/^cx_/, ''),
    formatCommandReference: (name) => `/cx_${name}`,
  };
  const logs = [];

  await registerDiscordCommands({
    client: {
      user: { id: 'app-1' },
      guilds: {
        cache: new Map([
          ['guild-1', { id: 'guild-1', name: 'One' }],
          ['guild-2', { id: 'guild-2', name: 'Two' }],
        ]),
      },
    },
    REST: MockREST,
    Routes: {
      applicationGuildCommands: (appId, guildId) => `/apps/${appId}/guilds/${guildId}/commands`,
    },
    discordToken: 'token-1',
    restProxyAgent: { proxy: true },
    commandSpecs: specs,
    commandRegistryRenderer: renderer,
    logger: {
      log: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
  });

  assert.deepEqual(renderCalls, [specs]);
  assert.deepEqual(restInstance.options, { version: '10' });
  assert.equal(restInstance.token, 'token-1');
  assert.deepEqual(restInstance.agent, { proxy: true });
  assert.deepEqual(restInstance.puts.map(([route]) => route), [
    '/apps/app-1/guilds/guild-1/commands',
    '/apps/app-1/guilds/guild-2/commands',
  ]);
  assert.deepEqual(restInstance.puts[0][1].body, [{ name: 'cx_status', description: 'Status' }]);
  assert.deepEqual(logs, [
    '📝 Registered 1 slash commands in guild: One',
    '📝 Registered 1 slash commands in guild: Two',
  ]);
});
