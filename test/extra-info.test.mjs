import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EXTRA_INFO_TEMPLATE,
  buildExtraInfoPromptLine,
  buildExtraInfoValues,
  renderExtraInfoTemplate,
} from '../src/extra-info.js';
import {
  DISCORD_DEFAULT_EXTRA_INFO_TEMPLATE,
  renderDiscordDefaultExtraInfo,
} from '../src/platforms/discord/extra-info.js';

test('extra info defaults to normalized conversation terminology', () => {
  const message = {
    id: 'msg-1',
    conversation: {
      id: 'conversation-1',
      parentId: 'parent-1',
    },
    channel: {
      id: 'raw-channel-ignored',
      parentId: 'raw-parent-ignored',
    },
  };

  assert.equal(
    DEFAULT_EXTRA_INFO_TEMPLATE,
    '[Via agents-in-discord; conversation={conversation}; parent={parent}]',
  );
  assert.deepEqual(buildExtraInfoValues({ message }), {
    conversation: 'conversation-1',
    thread: 'conversation-1',
    parent: 'parent-1',
    msg: 'msg-1',
  });
  assert.equal(
    buildExtraInfoPromptLine({ message }),
    '[Via agents-in-discord; conversation=conversation-1; parent=parent-1]',
  );
});

test('extra info keeps legacy thread placeholders for configured templates', () => {
  assert.equal(
    renderExtraInfoTemplate('conversation={conversation}; thread={thread}; legacy={discord_thread}', {
      conversation: 'conversation-1',
    }),
    'conversation=conversation-1; thread=conversation-1; legacy=conversation-1',
  );
});

test('extra info keeps raw message compatibility through centralized accessors', () => {
  assert.deepEqual(buildExtraInfoValues({
    message: {
      id: 'raw-message-1',
      channel: { id: 'raw-channel-1', parentId: 'raw-parent-1' },
    },
  }), {
    conversation: 'raw-channel-1',
    thread: 'raw-channel-1',
    parent: 'raw-parent-1',
    msg: 'raw-message-1',
  });
});

test('Discord keeps the existing default extra info output', () => {
  assert.equal(
    DISCORD_DEFAULT_EXTRA_INFO_TEMPLATE,
    '[Via agents-in-discord; discord_thread={thread}; parent={parent}]',
  );
  assert.equal(
    renderDiscordDefaultExtraInfo({
      conversation: 'thread-1',
      parent: 'parent-1',
    }),
    '[Via agents-in-discord; discord_thread=thread-1; parent=parent-1]',
  );
});
