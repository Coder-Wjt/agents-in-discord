const BOT_MENU_EVENT_KEY = 'application.bot.menu_v6';
const SDK_EXTENSION_MARK = Symbol.for('agents-in-discord.lark-bot-menu');

function normalizeId(value) {
  return String(value || '').trim() || null;
}

export function normalizeLarkBotMenuEvent(event) {
  const operator = event?.operator?.operator_id || event?.operator || {};
  const actorId = normalizeId(
    event?.operator_id
    || event?.operator_open_id
    || operator?.open_id,
  );
  const eventKey = normalizeId(event?.event_key);
  if (!actorId || !eventKey) {
    throw new TypeError('Lark bot menu event requires operator open_id and event_key.');
  }
  return {
    id: normalizeId(event?.event_id || event?.uuid) || `${eventKey}:${actorId}:${Date.now()}`,
    eventKey,
    actorId,
    actorName: String(event?.operator_name || event?.operator?.operator_name || actorId),
    tenantId: normalizeId(event?.tenant_key),
    timestamp: normalizeId(event?.timestamp || event?.menu_timestamp || event?.create_time),
    raw: event,
  };
}

function resolveMessageChatId(response) {
  const items = Array.isArray(response?.data?.items) ? response.data.items : [];
  return normalizeId(items[0]?.chat_id || response?.data?.chat_id || response?.chat_id);
}

function resolveMessageContext(response) {
  const items = Array.isArray(response?.data?.items) ? response.data.items : [];
  const item = items[0] || response?.data || response || {};
  return {
    chatId: normalizeId(item?.chat_id),
    rootId: normalizeId(item?.root_id),
    threadId: normalizeId(item?.thread_id),
  };
}

export function installLarkSdkBotMenuSupport(channel) {
  if (!channel || typeof channel !== 'object') {
    throw new TypeError('Lark SDK bot menu support requires a channel object.');
  }
  if (channel[SDK_EXTENSION_MARK]) return channel;
  if (typeof channel?.dispatcher?.register !== 'function' || typeof channel?.on !== 'function') {
    throw new TypeError('Lark SDK channel does not expose dispatcher.register() and on().');
  }

  let botMenuHandler = null;
  const baseOn = channel.on.bind(channel);
  const enrichCardAction = async (event) => {
    if (event?.rootId || event?.threadId || typeof channel?.rawClient?.im?.v1?.message?.get !== 'function') {
      return event;
    }
    const messageId = normalizeId(event?.messageId);
    if (!messageId) return event;
    try {
      const response = await channel.rawClient.im.v1.message.get({
        path: { message_id: messageId },
      });
      const context = resolveMessageContext(response);
      return {
        ...event,
        chatId: normalizeId(event?.chatId) || context.chatId,
        rootId: context.rootId,
        threadId: context.threadId,
      };
    } catch {
      return event;
    }
  };
  const wrapCardAction = (handler) => (typeof handler === 'function'
    ? async (event) => handler(await enrichCardAction(event))
    : handler);
  channel.on = (nameOrMap, handler) => {
    if (typeof nameOrMap === 'string') {
      if (nameOrMap === 'cardAction') return baseOn(nameOrMap, wrapCardAction(handler));
      if (nameOrMap !== 'botMenu') return baseOn(nameOrMap, handler);
      botMenuHandler = handler;
      return () => {
        if (botMenuHandler === handler) botMenuHandler = null;
      };
    }

    const handlers = { ...(nameOrMap || {}) };
    const menuHandler = handlers.botMenu;
    delete handlers.botMenu;
    if (handlers.cardAction) handlers.cardAction = wrapCardAction(handlers.cardAction);
    const unsubscribeRest = Object.keys(handlers).length ? baseOn(handlers) : () => {};
    if (menuHandler) botMenuHandler = menuHandler;
    return () => {
      unsubscribeRest?.();
      if (botMenuHandler === menuHandler) botMenuHandler = null;
    };
  };

  channel.dispatcher.register({
    [BOT_MENU_EVENT_KEY]: async (raw) => {
      if (typeof botMenuHandler !== 'function') return;
      await botMenuHandler(normalizeLarkBotMenuEvent(raw));
    },
  });

  if (typeof channel.send === 'function' && typeof channel?.rawClient?.im?.v1?.message?.get === 'function') {
    const baseSend = channel.send.bind(channel);
    channel.send = async (to, input, options) => {
      const result = await baseSend(to, input, options);
      if (!/^ou_/i.test(String(to || '')) || normalizeId(result?.chatId || result?.chat_id)) return result;
      const response = await channel.rawClient.im.v1.message.get({
        path: { message_id: result.messageId },
      });
      const chatId = resolveMessageChatId(response);
      return chatId ? { ...result, chatId } : result;
    };
  }

  Object.defineProperty(channel, SDK_EXTENSION_MARK, {
    value: true,
    enumerable: false,
  });
  return channel;
}
