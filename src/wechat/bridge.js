import os from 'node:os';
import path from 'node:path';

import { humanAge } from '../runtime-utils.js';

function shortId(value) {
  const text = String(value || '').trim();
  return text.length > 20 ? `${text.slice(0, 20)}...` : text;
}

function expandPath(value) {
  const text = String(value || '').trim();
  if (text === '~') return os.homedir();
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2));
  return path.resolve(text);
}

export function formatWechatSessionList(items, currentSessionId = null, now = Date.now()) {
  if (!items.length) return '没有找到允许范围内的 Codex 历史会话。';
  const lines = ['最近的 Codex 会话：', ''];
  items.forEach((item, index) => {
    const selected = item.id === currentSessionId ? '  [当前]' : '';
    lines.push(`${index + 1}. ${item.preview || '(无标题)'}${selected}`);
    lines.push(`   ${shortId(item.id)}`);
    lines.push(`   ${item.workspaceDir}`);
    lines.push(`   ${humanAge(Math.max(0, now - item.mtime))} 前`);
  });
  lines.push('', '使用 /resume <编号> 绑定，/new 新建会话。');
  return lines.join('\n');
}

export function createWechatBridge({
  ilink,
  sessionStore,
  codexRuntime,
  allowedUserIds,
  allowDangerous = false,
  logger = console,
} = {}) {
  const allowed = new Set(
    [...(allowedUserIds || [])].map((item) => String(item || '').trim()).filter(Boolean),
  );
  const deniedLogged = new Set();

  async function reply(userId, text) {
    await ilink.sendText(userId, String(text || ''));
  }

  function isAllowed(userId) {
    return allowed.has(String(userId));
  }

  async function showSessions(userId) {
    const session = sessionStore.get(userId);
    const items = sessionStore.listRecent(userId);
    await reply(userId, formatWechatSessionList(items, session.sessionId));
  }

  async function handleCommand(userId, input) {
    const [rawCommand, ...rest] = String(input || '').slice(1).trim().split(/\s+/);
    const command = String(rawCommand || '').toLowerCase();
    const argument = rest.join(' ').trim();
    const mutatingCommands = new Set(['resume', 'new', 'dir', 'model', 'effort', 'mode']);
    if (mutatingCommands.has(command) && codexRuntime.getActive(userId)) {
      throw new Error('当前任务仍在运行；请等待完成或先使用 /cancel');
    }

    if (command === 'help' || command === 'h') {
      await reply(userId, [
        'Agents in WeChat',
        '',
        '/status  当前会话和配置',
        '/sessions  最近 Codex 会话',
        '/resume <编号|thread-id>  绑定会话',
        '/session  当前会话',
        '/new  新建会话',
        '/cancel  取消运行中的任务',
        '/dir <路径>  切换工作目录并新建会话',
        '/model <模型|reset>  设置模型',
        '/effort <low|medium|high|xhigh|reset>',
        '/mode <safe|dangerous>  权限模式',
      ].join('\n'));
      return;
    }

    if (command === 'sessions' || (command === 'resume' && !argument)) {
      await showSessions(userId);
      return;
    }

    if (command === 'resume') {
      const session = sessionStore.bind(userId, argument);
      await reply(userId, [
        '已绑定 Codex 会话。',
        `session: ${session.sessionId}`,
        `workspace: ${session.workspaceDir}`,
      ].join('\n'));
      return;
    }

    if (command === 'session') {
      const session = sessionStore.get(userId);
      await reply(userId, [
        `session: ${session.sessionId || '(new)'}`,
        `workspace: ${session.workspaceDir}`,
      ].join('\n'));
      return;
    }

    if (command === 'status') {
      const session = sessionStore.get(userId);
      const active = codexRuntime.getActive(userId);
      await reply(userId, [
        `status: ${active ? 'running' : 'idle'}`,
        'provider: codex',
        `session: ${session.sessionId || '(new)'}`,
        `workspace: ${session.workspaceDir}`,
        `model: ${session.model || '(default)'}`,
        `effort: ${session.effort || '(default)'}`,
        `mode: ${session.mode}`,
      ].join('\n'));
      return;
    }

    if (command === 'new') {
      const session = sessionStore.startNew(userId);
      await reply(userId, `已解除旧会话；下一条消息会在 ${session.workspaceDir} 新建 Codex 会话。`);
      return;
    }

    if (command === 'cancel' || command === 'c' || command === 'abort') {
      const outcome = codexRuntime.cancel(userId);
      await reply(userId, outcome.cancelled ? '正在取消当前任务。' : '当前没有运行中的任务。');
      return;
    }

    if (command === 'dir') {
      if (!argument) {
        await reply(userId, `当前工作目录：${sessionStore.get(userId).workspaceDir}`);
        return;
      }
      const session = sessionStore.setWorkspace(userId, expandPath(argument));
      await reply(userId, `workspace: ${session.workspaceDir}\nsession: (new)`);
      return;
    }

    if (command === 'model') {
      if (!argument) {
        await reply(userId, `当前模型：${sessionStore.get(userId).model || '(default)'}`);
        return;
      }
      const model = ['reset', 'default', '默认'].includes(argument.toLowerCase()) ? null : argument;
      sessionStore.update(userId, { model });
      await reply(userId, `model: ${model || '(default)'}`);
      return;
    }

    if (command === 'effort') {
      const normalized = argument.toLowerCase();
      if (!argument) {
        await reply(userId, `当前 effort：${sessionStore.get(userId).effort || '(default)'}`);
        return;
      }
      const effort = ['reset', 'default', '默认'].includes(normalized) ? null : normalized;
      if (effort && !['low', 'medium', 'high', 'xhigh'].includes(effort)) {
        throw new Error('effort 仅支持 low、medium、high、xhigh 或 reset');
      }
      sessionStore.update(userId, { effort });
      await reply(userId, `effort: ${effort || '(default)'}`);
      return;
    }

    if (command === 'mode') {
      const mode = argument.toLowerCase();
      if (!mode) {
        await reply(userId, `当前 mode：${sessionStore.get(userId).mode}`);
        return;
      }
      if (!['safe', 'dangerous'].includes(mode)) {
        throw new Error('mode 仅支持 safe 或 dangerous');
      }
      if (mode === 'dangerous' && !allowDangerous) {
        throw new Error('微信 dangerous mode 已禁用；需要在环境中显式设置 WECHAT_ALLOW_DANGEROUS=true');
      }
      sessionStore.update(userId, { mode });
      await reply(userId, `mode: ${mode}`);
      return;
    }

    throw new Error(`未知命令：/${command}。使用 /help 查看命令。`);
  }

  async function handlePrompt(userId, text, quotedText = '') {
    if (codexRuntime.getActive(userId)) {
      await reply(userId, '当前任务仍在运行。可使用 /cancel 中止。');
      return;
    }
    const prompt = [text, quotedText ? `引用内容：\n${quotedText}` : ''].filter(Boolean).join('\n\n');
    if (!prompt.trim()) return;
    const typingPromise = ilink.startTyping(userId);
    const runPromise = codexRuntime.run(userId, prompt, {
      onWait: (lock) => {
        const channel = lock?.owner?.channel || lock?.owner?.key || '其他入口';
        void reply(userId, `工作目录正在被 ${channel} 使用，任务会在空闲后继续。`).catch(() => {});
      },
    });
    const stopTyping = await typingPromise;
    try {
      const result = await runPromise;
      if (result.busy) {
        await reply(userId, result.error);
      } else if (result.cancelled) {
        await reply(userId, '任务已取消。');
      } else if (!result.ok) {
        await reply(userId, `Codex 执行失败：${result.error || 'unknown error'}`);
      } else {
        const footer = [
          '',
          `session: ${result.sessionId || '(unknown)'}`,
          `workspace: ${result.workspaceDir}`,
        ].join('\n');
        await reply(userId, `${result.text || '完成（无文本输出）'}${footer}`);
      }
    } finally {
      stopTyping();
    }
  }

  async function handleMessage(message, parsed) {
    const userId = String(message?.from_user_id || '').trim();
    if (!isAllowed(userId)) {
      if (!deniedLogged.has(userId)) {
        deniedLogged.add(userId);
        logger.warn(`[wechat] rejected user ${userId}`);
      }
      return;
    }
    if (parsed.unsupportedMedia > 0) {
      await reply(userId, '当前首版微信入口暂不接收图片或文件，请先发送文本任务。');
      if (!parsed.text) return;
    }
    const text = String(parsed.text || '').trim();
    try {
      if (text.startsWith('/')) {
        await handleCommand(userId, text);
      } else {
        await handlePrompt(userId, text, parsed.quotedText);
      }
    } catch (err) {
      await reply(userId, `处理失败：${err?.message || err}`);
    }
  }

  ilink.onMessage(handleMessage);
  return {
    handleMessage,
    handleCommand,
    handlePrompt,
    showSessions,
    isAllowed,
  };
}
