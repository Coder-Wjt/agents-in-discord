import {
  getProviderCompactCapabilities,
  getSupportedReasoningEffortLevels,
  normalizeProvider,
} from './provider-metadata.js';
import { createCommandSpec } from './platforms/command-registry.js';
import {
  DEFAULT_CONVERSATION_PRESENTATION,
  assertConversationPresentation,
} from './platforms/conversation-presentation.js';

const ACTION_BUTTON_COMMAND_NAMES = Object.freeze(['status', 'sessions', 'queue', 'progress', 'new', 'cancel', 'retry']);

const PROVIDER_NATIVE_SESSION_COMMANDS = Object.freeze({
  codex: Object.freeze({
    resume: 'rollout_resume',
    sessions: 'rollout_sessions',
    sessionTerm: Object.freeze({
      singular: 'rollout session',
      plural: 'rollout sessions',
    }),
  }),
  claude: Object.freeze({
    resume: 'project_resume',
    sessions: 'project_sessions',
    sessionTerm: Object.freeze({
      singular: 'project session',
      plural: 'project sessions',
    }),
  }),
  antigravity: Object.freeze({
    resume: 'conversation_resume',
    sessions: 'conversation_sessions',
    sessionTerm: Object.freeze({
      singular: 'conversation',
      plural: 'conversations',
    }),
  }),
  zcode: Object.freeze({
    resume: 'zcode_resume',
    sessions: 'zcode_sessions',
    sessionTerm: Object.freeze({
      singular: 'ZCode session',
      plural: 'ZCode sessions',
    }),
  }),
  pi: Object.freeze({
    resume: 'pi_resume',
    sessions: 'pi_sessions',
    sessionTerm: Object.freeze({
      singular: 'Pi session',
      plural: 'Pi sessions',
    }),
  }),
  omp: Object.freeze({
    resume: 'omp_resume',
    sessions: 'omp_sessions',
    sessionTerm: Object.freeze({
      singular: 'OMP session',
      plural: 'OMP sessions',
    }),
  }),
});

const ALL_SESSION_COMMAND_ALIASES = Object.freeze({
  sessions: Object.freeze(['rollout_sessions', 'project_sessions', 'conversation_sessions', 'chat_sessions', 'zcode_sessions', 'pi_sessions', 'omp_sessions']),
  resume: Object.freeze(['rollout_resume', 'project_resume', 'conversation_resume', 'chat_resume', 'zcode_resume', 'pi_resume', 'omp_resume']),
});

const REASONING_LEVEL_DISPLAY_ORDER = Object.freeze(['auto', 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'off']);

const COMMAND_ALIASES = Object.freeze({
  c: 'cancel',
  dq: 'dequeue',
  abort: 'cancel',
  stop: 'cancel',
  fresh: 'new',
  next: 'new',
  start: 'new',
  onboard: 'onboarding',
  guide: 'onboarding',
  lang: 'language',
  cd: 'setdir',
  'extra-info': 'extra_info',
  extrainfo: 'extra_info',
  defaultdir: 'setdefaultdir',
  rollout_sessions: 'sessions',
  project_sessions: 'sessions',
  conversation_sessions: 'sessions',
  chat_sessions: 'sessions',
  zcode_sessions: 'sessions',
  pi_sessions: 'sessions',
  omp_sessions: 'sessions',
  rollout_resume: 'resume',
  project_resume: 'resume',
  conversation_resume: 'resume',
  chat_resume: 'resume',
  zcode_resume: 'resume',
  pi_resume: 'resume',
  omp_resume: 'resume',
});

export function normalizeCommandName(value, { allowBangPrefix = false } = {}) {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (allowBangPrefix && raw.startsWith('!')) raw = raw.slice(1);
  return COMMAND_ALIASES[raw] || raw;
}

export function getActionButtonCommandNames() {
  return [...ACTION_BUTTON_COMMAND_NAMES];
}

export function getProviderCommandAlias(provider, commandName) {
  const normalizedProvider = normalizeProvider(provider);
  const surface = PROVIDER_NATIVE_SESSION_COMMANDS[normalizedProvider];
  return surface?.[commandName] || '';
}

function getProviderSessionTerm(provider, { plural = false } = {}) {
  const normalizedProvider = normalizeProvider(provider);
  const surface = PROVIDER_NATIVE_SESSION_COMMANDS[normalizedProvider];
  if (!surface?.sessionTerm) return plural ? 'provider sessions' : 'provider session';
  return plural ? surface.sessionTerm.plural : surface.sessionTerm.singular;
}

function getSessionCommandAliases(commandName, botProvider = null) {
  if (!botProvider) return [...(ALL_SESSION_COMMAND_ALIASES[commandName] || [])];
  if (normalizeProvider(botProvider) === 'antigravity') {
    return commandName === 'sessions'
      ? ['conversation_sessions', 'chat_sessions']
      : ['conversation_resume', 'chat_resume'];
  }
  const alias = getProviderCommandAlias(botProvider, commandName);
  return alias ? [alias] : [];
}

function getSessionAliasDescriptions(aliases = []) {
  return Object.freeze(Object.fromEntries(aliases.map((alias) => {
    if (alias === 'rollout_sessions') return [alias, '列出最近的 rollout sessions（同 sessions）'];
    if (alias === 'project_sessions') return [alias, '列出最近的 project sessions（同 sessions）'];
    if (alias === 'conversation_sessions') return [alias, '列出最近的 conversations（同 sessions）'];
    if (alias === 'chat_sessions') return [alias, '列出最近的 legacy chat sessions（同 sessions）'];
    if (alias === 'zcode_sessions') return [alias, '列出最近的 ZCode sessions（同 sessions）'];
    if (alias === 'pi_sessions') return [alias, '列出最近的 Pi sessions（同 sessions）'];
    if (alias === 'omp_sessions') return [alias, '列出最近的 OMP sessions（同 sessions）'];
    if (alias === 'rollout_resume') return [alias, '继承一个已有的 rollout session（同 resume）'];
    if (alias === 'project_resume') return [alias, '继承一个已有的 project session（同 resume）'];
    if (alias === 'conversation_resume') return [alias, '继承一个已有的 conversation（同 resume）'];
    if (alias === 'chat_resume') return [alias, '继承一个已有的 legacy chat session（同 resume）'];
    if (alias === 'zcode_resume') return [alias, '继承一个已有的 ZCode session（同 resume）'];
    if (alias === 'pi_resume') return [alias, '继承一个已有的 Pi session（同 resume）'];
    if (alias === 'omp_resume') return [alias, '继承一个已有的 OMP session（同 resume）'];
    return [alias, alias];
  })));
}

function getCompactKeyChoices(botProvider = null) {
  const choices = [
    { name: 'status', value: 'status' },
    { name: 'run', value: 'run' },
    { name: 'strategy', value: 'strategy' },
    { name: 'token_limit', value: 'token_limit' },
  ];
  if (!botProvider || getProviderCompactCapabilities(botProvider).supportsNativeLimit) {
    choices.push({ name: 'native_limit', value: 'native_limit' });
  }
  choices.push(
    { name: 'enabled', value: 'enabled' },
    { name: 'reset', value: 'reset' },
  );
  return choices;
}

function getEffortChoices(botProvider = null) {
  if (!botProvider) {
    return [
      { name: 'xhigh', value: 'xhigh' },
      { name: 'high', value: 'high' },
      { name: 'medium', value: 'medium' },
      { name: 'low', value: 'low' },
      { name: 'default', value: 'default' },
    ];
  }
  const supported = new Set(getSupportedReasoningEffortLevels(botProvider));
  const levels = REASONING_LEVEL_DISPLAY_ORDER.filter((level) => supported.has(level));
  if (!levels.length) return [];
  return [
    ...levels.map((level) => ({ name: level, value: level })),
    { name: 'default', value: 'default' },
  ];
}

export function buildCommandSpecs({
  botProvider = null,
  conversationPresentation = DEFAULT_CONVERSATION_PRESENTATION,
} = {}) {
  const presentation = assertConversationPresentation(conversationPresentation);
  const lockedProvider = botProvider ? normalizeProvider(botProvider) : null;
  const sessionAliases = getSessionCommandAliases('sessions', lockedProvider);
  const resumeAliases = getSessionCommandAliases('resume', lockedProvider);
  const effortChoices = getEffortChoices(lockedProvider);
  const compactKeyChoices = getCompactKeyChoices(lockedProvider);
  const sessionPlural = lockedProvider ? getProviderSessionTerm(lockedProvider, { plural: true }) : 'provider sessions';
  const sessionSingular = lockedProvider ? getProviderSessionTerm(lockedProvider) : 'session';
  const childConversation = presentation.getTerm('childConversation', 'zh');
  const childConversationShort = presentation.getTerm('childConversationShort', 'zh');

  return [
    {
      name: 'status',
      description: '查看当前 thread 的 CLI 配置',
    },
    {
      name: 'settings',
      description: '打开当前频道的交互式设置面板',
    },
    {
      name: 'new',
      description: '切换到新会话，并保留当前频道配置',
    },
    {
      name: 'reset',
      description: '清空当前会话与额外配置，下条消息新开上下文',
    },
    {
      name: 'sessions',
      aliases: sessionAliases,
      description: lockedProvider ? `列出最近的 ${sessionPlural}` : '列出最近的 provider sessions',
      aliasDescriptions: getSessionAliasDescriptions(sessionAliases),
    },
    {
      name: 'setdir',
      description: '设置当前 thread 的工作目录（支持 browse/status/default/clear）',
      options: [{
        name: 'path',
        description: '绝对路径，或 browse/status/default/clear',
        required: true,
      }],
    },
    {
      name: 'setdefaultdir',
      description: '设置当前 provider 的默认工作目录（支持 browse/status/clear）',
      options: [{
        name: 'path',
        description: '绝对路径，或 browse/status/clear',
        required: true,
      }],
    },
    !botProvider && {
      name: 'provider',
      description: '切换当前频道使用的 CLI provider',
      options: [{
        name: 'name',
        description: 'provider',
        required: true,
        choices: [
            { name: 'codex', value: 'codex' },
            { name: 'claude', value: 'claude' },
            { name: 'antigravity', value: 'antigravity' },
            { name: 'zcode', value: 'zcode' },
            { name: 'pi', value: 'pi' },
            { name: 'omp', value: 'omp' },
            { name: 'status', value: 'status' },
        ],
      }],
    },
    {
      name: 'model',
      description: '打开模型与推理力度选择面板',
    },
    (!lockedProvider || lockedProvider === 'codex') && {
      name: 'fast',
      description: '切换 Codex Fast mode（on/off/status/default）',
      options: [{
        name: 'action',
        description: 'Fast mode 操作',
        required: true,
        choices: [
            { name: 'on', value: 'on' },
            { name: 'off', value: 'off' },
            { name: 'status', value: 'status' },
            { name: 'default', value: 'default' },
        ],
      }],
    },
    (!lockedProvider || lockedProvider === 'claude' || lockedProvider === 'codex') && {
      name: 'runtime',
      description: '切换运行时接入方式（exec/long/status/default）',
      options: [{
        name: 'mode',
        description: 'runtime mode',
        required: true,
        choices: [
            { name: 'exec', value: 'normal' },
            { name: 'long', value: 'long' },
            { name: 'status', value: 'status' },
            { name: 'default', value: 'default' },
        ],
      }],
    },
    effortChoices.length && {
      name: 'effort',
      description: '设置 reasoning effort',
      options: [{
        name: 'level',
        description: '推理力度',
        required: true,
        choices: effortChoices,
      }],
    },
    {
      name: 'compact',
      description: lockedProvider && !getProviderCompactCapabilities(lockedProvider).supportsNativeLimit
        ? '配置上下文压缩（hard/native/off、token_limit、enabled、status）'
        : '配置上下文压缩（hard/native/off、limit、enabled、status）',
      options: [
        {
          name: 'key',
          description: '配置项',
          required: true,
          choices: compactKeyChoices,
        },
        {
          name: 'value',
          description: '值：如 native / 272000 / on / default',
          required: false,
        },
      ],
    },
    {
      name: 'extra_info',
      aliases: ['extrainfo'],
      description: '配置每条 prompt 的额外信息（开关、内容、token 占用）',
      options: [
        {
          name: 'key',
          description: '配置项',
          required: true,
          choices: [
              { name: 'status', value: 'status' },
              { name: 'on', value: 'on' },
              { name: 'off', value: 'off' },
              { name: 'text', value: 'text' },
              { name: 'default', value: 'default' },
          ],
        },
        {
          name: 'value',
          description: 'text 内容；优先用 {thread} {parent}，{msg} 会按消息变化',
          required: false,
        },
      ],
    },
    {
      name: 'mode',
      description: '执行模式',
      options: [{
        name: 'type',
        description: '模式',
        required: true,
        choices: [
            { name: 'safe (sandbox + auto-approve)', value: 'safe' },
            { name: 'dangerous (无 sandbox 无审批)', value: 'dangerous' },
        ],
      }],
    },
    {
      name: 'name',
      description: lockedProvider ? `给当前 ${sessionSingular} 起个名字，方便识别` : '给当前 session 起个名字，方便识别',
      options: [{
        name: 'label',
        description: '名字，如「cc-hub诊断」「埋点重构」',
        required: true,
      }],
    },
    {
      name: 'resume',
      aliases: resumeAliases,
      description: lockedProvider ? `继承一个已有的 ${sessionSingular}` : '继承一个已有的 session',
      aliasDescriptions: getSessionAliasDescriptions(resumeAliases),
      options: [{
        name: 'session_id',
        description: lockedProvider ? `${sessionSingular} UUID` : 'provider session UUID',
        required: true,
      }],
    },
    (!lockedProvider || lockedProvider === 'codex' || lockedProvider === 'claude') && {
      name: 'fork',
      description: `用当前 provider 原生 fork 创建一个新的 ${childConversation}，可选指定 ${childConversationShort} 名`,
      requiredCapabilities: ['threads'],
      options: [{
        name: 'name',
        description: `可选：新 ${childConversationShort} 名；留空自动生成`,
        required: false,
      }],
    },
    (!lockedProvider || lockedProvider === 'codex') && {
      name: 'side',
      description: '开启或管理 Codex 临时 side conversation',
      requiredCapabilities: ['threads'],
      options: [
        {
          name: 'action',
          description: 'side 操作',
          required: false,
          choices: [
              { name: 'start', value: 'start' },
              { name: 'status', value: 'status' },
              { name: 'close', value: 'close' },
          ],
        },
        {
          name: 'name',
          description: `可选：新 side ${childConversationShort} 名`,
          required: false,
        },
      ],
    },
    (!lockedProvider || lockedProvider === 'codex') && {
      name: 'goal',
      description: '管理当前 Codex session 的持久目标；active 时会自动续跑',
      options: [
        {
          name: 'action',
          description: 'goal 操作',
          required: true,
          choices: [
              { name: 'status 查当前 goal', value: 'status' },
              { name: 'set 设置 goal', value: 'set' },
              { name: 'pause 标记暂停', value: 'pause' },
              { name: 'resume 标记进行中', value: 'resume' },
              { name: 'done 标记完成', value: 'done' },
              { name: 'clear 清除 goal', value: 'clear' },
              { name: 'budget 设置预算', value: 'budget' },
          ],
        },
        {
          name: 'objective',
          description: 'set 时填写目标；带附件请用普通消息 !goal',
          required: false,
        },
        {
          name: 'token_budget',
          description: 'token 预算，如 120000；clear 清除预算',
          required: false,
        },
      ],
    },
    {
      name: 'queue',
      description: '查看当前频道的任务队列状态',
    },
    {
      name: 'upgrade',
      description: '检查或升级 agents-in-discord 项目本体',
      options: [
        {
          name: 'action',
          description: '升级操作',
          required: true,
          choices: [
              { name: 'status 检查远端版本', value: 'status' },
              { name: 'apply 执行安全升级', value: 'apply' },
              { name: 'mode 设置升级模式', value: 'mode' },
          ],
        },
        {
          name: 'mode',
          description: 'mode 可选 off / notify / auto；默认 notify',
          required: false,
          choices: [
              { name: 'off 关闭检查', value: 'off' },
              { name: 'notify 只提示', value: 'notify' },
              { name: 'auto 自动升级', value: 'auto' },
          ],
        },
      ],
    },
    {
      name: 'doctor',
      description: '查看 bot 运行与安全配置体检',
    },
    {
      name: 'onboarding',
      description: '新用户引导：安装后检查与首跑步骤（按钮分步）',
    },
    {
      name: 'onboarding_config',
      description: '配置 onboarding 开关（当前频道）',
      options: [{
        name: 'action',
        description: '操作',
        required: true,
        choices: [
            { name: 'on', value: 'on' },
            { name: 'off', value: 'off' },
            { name: 'status', value: 'status' },
        ],
      }],
    },
    {
      name: 'language',
      description: '设置消息提示语言（中文/English）',
      options: [{
        name: 'name',
        description: '语言',
        required: true,
        choices: [
            { name: '中文', value: 'zh' },
            { name: 'English', value: 'en' },
        ],
      }],
    },
    {
      name: 'profile',
      description: '设置当前频道 security profile（auto/solo/team/public）',
      options: [{
        name: 'name',
        description: 'profile',
        required: true,
        choices: [
            { name: 'auto', value: 'auto' },
            { name: 'solo', value: 'solo' },
            { name: 'team', value: 'team' },
            { name: 'public', value: 'public' },
            { name: 'status', value: 'status' },
        ],
      }],
    },
    {
      name: 'timeout',
      description: '设置当前频道 runner timeout（ms/off/status）',
      options: [{
        name: 'value',
        description: '如 60000 / off / status',
        required: true,
      }],
    },
    {
      name: 'progress',
      description: '查看当前任务的最新执行进度',
    },
    {
      name: 'cancel',
      aliases: ['abort'],
      description: '中断当前任务并清空排队消息',
    },
  ].filter(Boolean).map((entry) => createCommandSpec(entry));
}

export function buildSlashCommandEntries(options = {}) {
  return buildCommandSpecs(options);
}
