# 多平台 Adapter 演进方案

## 背景与目标

本项目目前以 Discord 作为消息入口，但核心能力——会话状态、Provider runner、频道队列、工作区绑定、跨进程锁、设置与安全策略——并不应绑定到单一聊天平台。

本方案的目标是在保留 Discord 现有行为的前提下，引入稳定的平台抽象层，随后逐步支持 Slack 和飞书/Lark。截至 `03efc7c`，平台契约、Discord Adapter、核心平台边界和统一 Foundation 组合已经落地；当前不添加 Slack/Lark SDK、配置或业务逻辑，下一步先完成第二平台接入前的边界清理与契约加固。

## 实施状态

本节以本地提交 `30e1df5..03efc7c` 为同步基线。原先统一归在“阶段 2 进行中”的工作，现按实际依赖关系重排如下：

| 阶段 | 状态 | 对应提交 | 当前结果 |
| --- | --- | --- | --- |
| 阶段 0：方案与边界基线 | 已完成 | `30e1df5` | 明确 Adapter 目标架构、能力模型、会话迁移约束及“不提前引入 Slack/Lark”的范围。 |
| 阶段 1：平台契约与 Discord 端口 | 已完成 | `55903a3`、`8af2e8a` | 平台契约、capability policy、Foundation、统一输入/输出端口及 Discord 实现已建立。 |
| 阶段 2：核心平台无关化 | 已完成 | `ee2a4d9`、`27380e7`、`34c3b8f`、`c212fb8`、`18414af` | command/UI、inbound context、runtime delivery、conversation lifecycle/presentation 和 security 已改为消费平台端口。 |
| 阶段 3：Foundation 统一组合与 Discord 回归 | 已完成 | `03efc7c` | `createAppContext()` 通过单一 Foundation 获取平台服务并创建 Adapter，Discord 启动、配置、session 与用户可见行为保持兼容。 |
| 阶段 4：第二平台准入准备 | 下一阶段 | 尚无对应提交 | 清理兼容 facade/别名、把 Discord 默认组合进一步收口到启动边界、补齐可复用 Adapter 契约套件与接入门槛。 |
| 阶段 5：Slack Adapter | 未开始 | — | 等阶段 4 验收后再引入 SDK、配置和业务入口。 |
| 阶段 6：飞书/Lark Adapter | 未开始 | — | 在 Slack 契约实践稳定后接入，避免并行复制未定型的平台假设。 |
| 阶段 7：多平台迁移与统一运维 | 未开始 | — | 最后启用平台限定会话键、多实例配置、迁移工具与统一健康指标。 |

当前已完成能力包括：

- 统一 command spec/view、interaction response、message/notification delivery、inbound message/interaction envelope、conversation spawn/presentation/security 和 text presentation 契约。
- command、prompt、queue、settings、workspace、fork/side、session topology 和 project upgrade scheduler 已通过平台端口工作；Discord 原始对象只在入口、投递、安全推断和兼容 accessor 等边界使用。
- `threads`、`slashCommands`、`buttons`、`selectMenus`、`modals`、`messageEdits`、`reactions`、`attachments` 已有显式 capability 和降级策略。
- 生产组合根已使用 Discord Foundation；现有 Discord session key、`sessions.json`、环境变量、命令 JSON、启动方式和主要用户可见文案保持不变。
- `slash-command-surface.js`、raw message fallback、`childThread` / `discordCleanup` / `discordArchive` 等只作为迁移期兼容面保留，不再代表核心架构方向。
- `src/platforms/` 当前仍只有 Discord 实现，未新增 Slack/Lark SDK、配置、目录或业务入口。

### 2026-07-25 本地提交同步验证

- `npm run test:platform-foundation`：11/11 通过。
- `npm run test:platform-security`：20/20 通过。
- `npm run test:platform-inputs`：182/182 通过。
- `npm run test:platform-presentation`：192/192 通过。
- `npm run test:platform-notifications`：16/16 通过。
- `npm run check:reply-fallback` 与 `git diff --check` 通过。
- 本轮采用平台聚焦回归确认阶段状态；下列 2026-07-24 记录继续保留每次增量实现时的完整回归证据。

## 增量实现验证记录

### 2026-07-24 验证记录

- interaction response、command UI、Discord renderer、Adapter 组合、onboarding、workspace busy、workspace browser、settings panel 和 slash router 聚焦测试：129/129 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：608/608 通过。
- 新增 interaction response 契约、Discord interaction 映射和 message delivery command view 渲染测试。
- 扩展 `test/command-view-boundaries.test.mjs`，同时防止 Discord Builder/Style、`flags`、原始 `components` 和直接 `interaction.reply/update/showModal/deferReply` 再次泄漏到 command 核心模块。
- `test/runner-executor.test.mjs` 独立结果仍为 11 通过、5 个 `cancelledByParent`、0 个断言失败；该问题与本次平台抽象改动无关。
- `npm run check:reply-fallback`、关键文件语法检查和 `git diff --check` 均通过。

### 2026-07-24 slash command 注册表验证记录

- 新增 command spec/option 和 command registry renderer 契约，以及 Discord renderer 与 REST registration 实现。
- `command-spec.js` 中全部 Discord builder 回调已转换为纯数据 options；边界测试禁止核心重新出现 `SlashCommandBuilder`、`addStringOption` 或 `configure(builder)`。
- 新增 command registry 契约、Discord registry renderer 和 Discord registration 测试，并更新 Adapter、app context、entry handler 与 command spec 回归测试。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：615/615 通过。
- 使用改造前 `HEAD` 实现逐 provider 对比完整 Discord slash command JSON：shared 42、Codex 33、Claude 30、Antigravity 29、ZCode 27，名称、描述、别名、选项、choices、顺序和数量全部一致。
- `npm run check:reply-fallback`、关键文件语法检查和 `git diff --check` 均通过。

### 2026-07-24 inbound interaction envelope 验证记录

- 新增统一 interaction envelope 及读取 helper，覆盖 command、button、select、modal 和 unknown 类型；Discord normalizer 映射 command option、actor、conversation、component values、modal fields、client 与 `responseTarget`。
- Discord entry handler 在入口只规范化一次，command router、goal modal、onboarding、workspace busy、workspace browser、settings panel component/modal 均接收同一 envelope。
- Discord interaction response 和 message delivery 均支持从 `responseTarget` 解包，核心可以直接用 envelope 进行交互响应和频道投递。
- 扩展 command view 边界测试，禁止 slash router、onboarding、workspace busy、workspace browser 和 settings panel 重新读取 Discord 原始 interaction 输入字段。
- interaction、组件核心、Settings、Discord Adapter 与边界聚焦回归：144/144 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：621/621 通过。
- `npm run check:reply-fallback` 与 `git diff --check` 均通过。

### 2026-07-24 capability-aware command/UI 验证记录

- 新增统一 command/UI capability policy，覆盖 command registry、command view renderer 和 interaction response；内部 policy 标记保证 AppContext 与 Adapter 组合时幂等。
- command spec 支持 `requiredCapabilities` 并校验 capability 名称；`fork`、`side` 只在平台支持 `threads` 时进入原生命令注册表。
- 无 `slashCommands` 时停止注册原生命令，并将命令引用格式化为 `!command`；文本命令路由继续可用。
- 无 `buttons` 或 `selectMenus` 时过滤不支持的控件，并使用各功能提供的中英文 `fallbackText`；已覆盖 onboarding、workspace busy/browser、settings 和 model panel。
- 无 `modals` 时不调用平台 modal API，改用 view 自带 fallback 或通用表单说明消息。
- Retry 与 Progress Reporter 不再产生原始 Discord `components`；新增 `!retry` 文本命令并由 AppContext 注入 `retryLastPrompt`。
- capability/UI、Retry、Progress Reporter 与平台边界聚焦回归：252/252 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：626/626 通过。
- `npm run check:reply-fallback` 与 `git diff --check` 均通过。

### 2026-07-24 runtime capability 验证记录

- 新增 `runtime-capability-policy.js`，统一包装 message delivery 与 inbound event normalizer；policy 带幂等标记，AppContext 与 Adapter 重复组合不会重复包装。
- `threads` 同时控制原生命令注册、文本/slash 执行、帮助条目和 Discord thread listener；即使外部手动路由命令，也不会调用 thread flow。
- `messageEdits` 关闭时不执行 message edit，interaction update 降级为 respond，AppContext 关闭持续进度卡；Progress Reporter 缺少 delivery port 时保持静默而不留下无法更新的运行中消息。
- `reactions` 关闭时 `setMessageStatus` 安全 no-op；新增 `dequeued` 语义状态，Discord 映射为 `🗑️`，核心 queue、text command 和 entry error path 不再直接操作 reaction。
- inbound message context 以 normalized actor、conversation 和 attachments 为权威数据，同时通过 `responseTarget` 保留原平台投递目标；附件文本与原生图片输入同时兼容 normalized attachment 结构。
- runtime capability、核心边界、Discord delivery/entry、线程命令、附件和进度聚焦回归：171/171 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：636/636 通过。

### 2026-07-24 conversation spawn 验证记录

- 新增 `conversationSpawn` 契约与 Discord 实现，统一提供 `canSpawn`、`spawn`、`rename`、`remove`、`archive`、`send`、`listRecentMessages`、`splitText`、`createPromptMessage`、用户 mention 和 conversation reference 格式化。
- `codex-fork-flow.js` 与 `codex-side-flow.js` 不再直接调用 Discord thread API，也不再直接构造 `allowedMentions`、Discord mention/reference 或引用 Discord 文本分片器；边界测试持续禁止这些依赖回流。
- Discord fork/side 的线程名称、origin notice、最近一次 agent 输出回放、失败清理、关闭锁定/归档和既有 session/channel 持久化字段保持不变。
- conversation spawn、fork/side、router、Adapter 与 AppContext 聚焦回归：89/89 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：643/643 通过。
- `npm run check:reply-fallback`、全量 JavaScript 语法检查和 `git diff --check` 均通过。

### 2026-07-24 normalized conversation topology 验证记录

- inbound message/interaction 契约现在要求 `conversation.isThread` 为布尔值，并校验可选 `conversation.parentId`，确保 Adapter 提供稳定的父子会话拓扑。
- session-store 使用 normalized conversation 更新既有 `parentChannelId`；显式 fork/side parent 绑定继续优先，不修改 `sessions.json` schema、session key 或 workspace 继承策略。
- 消息、命令、队列、prompt 和交互组件的 session 获取路径均已传递 normalized conversation；Discord raw channel 仍只用于平台投递、安全策略和 SDK 边界。
- 新增边界测试，禁止 session-store 重新调用 `.isThread()` 或读取 Discord channel parent 字段。
- topology 契约、Discord inbound/entry 与 session-store 聚焦回归：39/39 通过；受影响的 command、queue、prompt 和组件回归：181/181 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：644/644 通过。

### 2026-07-24 project upgrade notification delivery 验证记录

- 新增 `notificationDelivery` 契约和 Discord 实现，Adapter 与 AppContext 将其作为独立平台端口组合并暴露。
- `project-upgrade-scheduler.js` 改用平台无关 conversation ID 和 notification payload；边界测试禁止 Discord client、channel fetch 或 channel send 重新进入 scheduler。
- `PROJECT_UPGRADE_NOTIFY_CHANNEL_IDS` 继续在 Discord 启动组合根解析，并映射为 scheduler 的 `notifyConversationIds`，不改变现有环境变量或运维配置。
- notification 契约、Discord 实现、边界和项目升级行为聚焦回归：16/16 通过。

### 2026-07-24 prompt/message presentation 验证记录

- `createPromptRuntime()` 与 `createPromptOrchestrator()` 现在要求完整 message delivery 端口；terminal reply、后续分片、typing、用户 mention 和过程消息均只调用端口语义。
- report formatter 通过注入的 `formatUserMention()` 渲染 queue author；Settings 和 slash router 不再包含原始 `channel.send()` fallback。
- extra-info 值优先读取 normalized `message.conversation.id/parentId`，核心默认文案使用 conversation 术语；新增 Discord 默认模板模块，生产启动继续生成原有 `discord_thread` 文本。
- 新增 presentation 边界测试，禁止上述核心模块重新出现 Discord mention、原始 channel send、`splitForDiscord` 或 Discord 网络重试依赖。
- extra-info、prompt/runtime、report、Settings、slash router、AppContext 和边界聚焦回归：151/151 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：656/656 通过。

### 2026-07-24 conversation presentation/terminology 验证记录

- 新增平台无关 `conversationPresentation` 契约、通用默认词汇表和 Discord 词汇表；Adapter 与 AppContext 复用同一个 presentation 实例。
- command spec、帮助输出、fork/side 创建错误、来源通知、状态标签和 Codex side runtime 指令不再在核心中硬编码 `Discord channel/thread`。
- `slash-command-surface.js` 作为 Discord 兼容 facade 显式注入 Discord presentation；生产 AppContext 也显式使用 Discord 实现，因此现有命令注册 JSON 和用户可见文案不变。
- 新增精确字符串与核心边界测试；`npm run test:platform-presentation`：186/186 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：661/661 通过。

### 2026-07-24 normalized message input/accessor 验证记录

- inbound message envelope 新增可选 `replyToMessageId` 契约与 Discord reference 映射；字段可省略或为 `null`，存在时必须是非空字符串。
- 新增平台无关 message accessor，normalized-only 消息无需构造 Discord `author`、`channel`、`attachments` 或 `reference` 即可完成 session topology、security target、queue ownership、回复撤回、goal 附件和 native image 流程。
- `message-input.js` 接管通用附件 prompt 格式化，`discord-message-input.js` 作为兼容 facade 继续导出原有函数引用；Discord 入口与 `src/index.js` 无需迁移。
- 新增 `test:platform-inputs` 聚焦脚本和核心消息上下文边界测试；聚焦回归：117/117 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：668/668 通过。

### 2026-07-24 runtime/history message contract 验证记录

- 新增通用 `getInboundActorId()`，统一处理 normalized actor 与兼容期 raw message/interaction actor；message 和 interaction accessor 复用同一实现。
- conversation spawn 契约新增 history message 校验，要求稳定的消息 ID、文本、时间戳和 `actor.isBot/isCurrentBot` 元数据；fork replay 在核心入口再次校验 Adapter 返回值。
- channel runtime 的 queue snapshot、extra-info conversation/parent fallback 和 fork requester/history 选择均不再直接读取 Discord `author/channel/content/createdTimestamp` 字段。
- Discord history normalizer 继续提供 `author` 兼容别名，现有 Discord thread 创建、历史回放、mention、session binding 和用户文案保持不变。
- `test:platform-inputs` 扩展后聚焦回归：141/141 通过；排除既有挂起用例后的全量项目回归：671/671 通过。

### 2026-07-24 slash synthetic prompt message 验证记录

- slash router 删除本地 `createInteractionPromptMessage()` Discord-shaped 构造器，goal 自动续跑和手动 compact 统一调用 conversation spawn 端口。
- Discord `createPromptMessage()` 现在生成 normalized actor、conversation topology 和空附件数组，同时保留 `channel/channelId/author/reply` 兼容字段供现有 Discord delivery 使用。
- synthetic reply 可注入 message delivery send 回调；slash 后续过程消息继续发送到当前 conversation，而不是依赖已确认过的 interaction webhook。
- 边界测试禁止 slash core 重新构造 reactions/message SDK 形状；`test:platform-inputs`：181/181 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：673/673 通过。

### 2026-07-24 side requester actor 验证记录

- `codex-side-flow.js` 与 fork flow 一致，统一调用 `getInboundActorId()`，删除核心中的 `source.author` / `source.user` 平台兼容读取。
- 文本 side 回归使用 normalized-only actor/conversation 输入，仍能创建 Discord thread、写入 requester binding、发送 mention notice 并保持既有用户文案。
- 边界测试覆盖 fork/side requester 读取，防止平台原始 actor 字段重新进入核心 flow。
- `test:platform-inputs`：182/182 通过。

### 2026-07-24 conversation security 验证记录

- 新增 conversation security descriptor/resolver 契约，统一表达 conversation/parent/tenant ID、DM 语义、public/team/unknown 可见性及推断原因，并列入 Platform Adapter 必填组件。
- `security-policy.js` 不再调用 Discord `isThread()`、`isDMBased()`、`permissionsFor()` 或读取 Guild role；profile、mention-only 和 queue limit 只消费通用 descriptor。
- Discord resolver 继续对 thread 使用父频道权限，并按 `@everyone` 的 `ViewChannel` 结果生成与原实现一致的 profile/reason；现有 Guild/频道 mention-only 覆盖配置保持原语义。
- `createAppContext()` 与 Discord Adapter 复用同一个 resolver；未改变环境变量、session key、`sessions.json` 或启动入口。
- `test:platform-security`：20/20 通过；`test:platform-inputs`：182/182 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：681/681 通过。
- `npm run check:reply-fallback`、全部 `src/**/*.js` 语法检查和 `git diff --check` 均通过；`src/platforms/` 仍只有 Discord 平台实现。

### 2026-07-24 text presentation 与 platform foundation 验证记录

- report formatter 新增 `formatConversationReference()` 注入，fork 来源不再在核心拼接 `<#id>`；Discord composition 继续通过 conversation spawn renderer 输出原有 channel mention。
- 新增 text presentation 契约并列入 Foundation/Adapter 必填组件；核心 runtime 默认保持文本原样，Discord 实现显式中和 `||` spoiler 标记，现有进度卡显示不变。
- 新增 platform foundation 契约与 Discord foundation，统一提供 capability-aware command registry/view、interaction response、message/notification delivery、conversation spawn/presentation/security 和 text presentation。
- `createAppContext()` 只从 foundation 获取 pre-core 平台服务，并调用同一 foundation 的 `createAdapter()` 完成 access、entry 与 lifecycle 组合；仍保留原 factory 注入兼容面。
- `test:platform-foundation`：11/11、`test:platform-presentation`：192/192、`test:platform-security`：20/20、`test:platform-inputs`：182/182 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：689/689 通过。
- 未新增 Slack/Lark SDK、配置、目录或业务入口；Discord session key、持久化格式、环境变量和启动方式保持不变。

## 设计原则

- 核心运行时继续复用，不为每个平台复制 session、queue、runner 或 workspace lock。
- 平台差异集中在 Adapter 内，包括鉴权、事件接入、交互响应、消息投递和客户端生命周期。
- 平台能力显式声明。上层功能按 capability 降级，不能假设每个平台都支持 Discord 的线程、按钮或 modal。
- Discord 零迁移。当前基线保持现有频道 ID session key、`sessions.json`、环境变量和启动方式不变。
- 渐进式拆分。已形成组合边界并完成主要核心迁移；下一步继续清理兼容面，再进入第二平台实现。
- 长连接优先。后续 Slack 默认采用 Socket Mode，飞书/Lark 默认采用 WebSocket 长连接，降低部署公网回调地址的门槛。

## 目标架构

```text
src/
  message-input.js
  platforms/
    contracts.js
    foundation.js
    capabilities.js
    conversation-key.js
    command-registry.js
    command-ui-policy.js
    runtime-capability-policy.js
    command-view.js
    inbound-event.js
    interaction-response.js
    message-delivery.js
    notification-delivery.js
    conversation-spawn.js
    conversation-presentation.js
    conversation-security.js
    text-presentation.js
    index.js
    discord/
      adapter.js
      foundation.js
      command-registration.js
      command-registry-renderer.js
      command-view-renderer.js
      inbound-event.js
      extra-info.js
      interaction-response.js
      message-delivery.js
      notification-delivery.js
      conversation-spawn.js
      conversation-presentation.js
      conversation-security.js
      text-presentation.js
    slack/                 # 后续阶段
      adapter.js
    lark/                  # 后续阶段
      adapter.js
```

Platform foundation 在创建核心 runtime 前提供 capability、命令/UI renderer、投递、conversation 与 presentation 端口，并暴露 `createAdapter()` 完成 access policy、entry handler 和 lifecycle 的后半段组合。`createAppContext()` 只消费这一个入口；Discord 兼容默认仍由 Discord foundation 提供。

平台 Adapter 的最小结构：

```js
{
  id: 'discord',
  capabilities: { /* 平台能力 */ },
  commandRegistryRenderer: { /* command spec -> 平台命令 */ },
  commandViewRenderer: { /* view model -> 平台 UI */ },
  interactionResponse: { /* respond/update/modal/defer */ },
  eventNormalizer: { /* 平台事件 -> 统一 inbound envelope */ },
  messageDelivery: { /* reply/send/edit/typing/status */ },
  notificationDelivery: { /* 后台通知 -> 指定会话 */ },
  conversationSpawn: { /* spawn/rename/remove/archive/send/history */ },
  conversationPresentation: { /* 平台会话术语 */ },
  conversationSecurity: { /* 会话租户、父会话、DM 与可见性 */ },
  textPresentation: { /* 平台显示文本清理 */ },
  accessPolicy: { /* 用户、空间和频道准入 */ },
  entryHandlers: { /* 消息、命令和交互入口 */ },
  lifecycle: { /* 客户端启动、自愈和关闭 */ },
}
```

`createAppContext()` 负责创建平台无关的核心组件，再把所需依赖传给当前平台 Adapter。启动流程继续只依赖 `lifecycle`，因此已有 `bootApp()` 无需感知具体平台。

## 平台契约

### Conversation security

统一 conversation security resolver 将平台原始会话解析为 `conversationId`、`parentConversationId`、`tenantId`、`isDirect`、`visibility` 和 `reason`。核心 security policy 只据此选择 `solo/team/public` profile、mention-only 覆盖与队列上限，不调用平台权限 API。

Discord resolver 负责识别 DM、把 thread 权限判断落到父频道，并通过 Guild `@everyone` 的 `ViewChannel` 权限区分 public/team；既有 `MENTION_ONLY_*_GUILD_IDS`、频道覆盖、`SECURITY_PROFILE`、fallback reason 和用户可见报告保持不变。未来 Slack/Lark 应分别用 workspace/chat membership 与平台公开范围生成同一描述符，不能在核心策略中增加新的 SDK 分支。

### Access policy

负责判断用户、频道/会话和组织空间是否允许访问。不同平台可使用各自概念：

| 通用概念 | Discord | Slack | 飞书/Lark |
| --- | --- | --- | --- |
| 租户/空间 | Guild | Workspace/Team | Tenant |
| 会话容器 | Channel/Thread | Channel/DM | Chat |
| 用户 | User | User | User/Open ID |

当前 Discord 基线复用 `createDiscordAccessPolicy()`，不改变原有 allowlist 语义。

### Entry handlers

负责把平台事件转换为项目现有的命令或 prompt 调用，并把平台对象保留为投递上下文。当前 Discord 基线复用 `createDiscordEntryHandlers()`，后续 Adapter 应统一提供以下入口能力：

- 普通消息和附件输入；
- 文本命令与平台原生命令；
- 按钮、菜单、modal/card 回调；
- 平台事件监听绑定；
- 事件去重、超时确认和错误兜底。

### Lifecycle

负责创建客户端、绑定事件、连接、重连、自愈和关闭。核心启动代码只调用生命周期契约，不直接引用平台 SDK。

### Capabilities

Adapter 显式声明 `threads`、`slashCommands`、`buttons`、`selectMenus`、`modals`、`messageEdits`、`reactions`、`attachments` 等能力。command/UI policy 负责命令和控件降级，runtime policy 负责消息编辑、reaction 与附件输入降级；线程能力同时由注册层、执行层和平台事件监听层约束。

### Inbound event normalizer

平台原始消息先规范化为统一 envelope，再进入准入、会话映射和 prompt 路由。当前 message envelope 包含：

- `platformId`、事件类型和消息 ID；
- actor ID、显示名与 bot 标记；
- tenant/conversation/parent/thread 信息；
- 原始正文、清理平台 bot mention 后的正文；
- 标准化附件元数据；
- 可选的被回复消息 ID；
- system message 与是否定向 bot 的标记；
- 供兼容期调用现有命令模块的原始平台对象。

消息进入核心前会由 envelope 构造 normalized message context。actor ID、conversation、conversation target、conversation ID、attachments 和 reply reference 通过统一 accessor 读取，并始终优先采用 normalized envelope；`responseTarget` 仅供平台 delivery 在边界处解包。过渡期原始 Discord message fallback 只保留在 accessor 内，避免准入、队列所有权、附件 prompt、回复撤回与原生图片输入分别读取出语义不一致的平台字段。

平台原始交互也先规范化为统一 interaction envelope，再进入 command 和组件核心。当前 interaction envelope 包含：

- `kind`：`command`、`button`、`select`、`modal` 或 `unknown`；
- actor 与 conversation 上下文；
- command name 和平台无关 option 读取器；
- component ID 与 values；
- modal ID 与 field 读取器；
- `responseTarget`，由平台 response/delivery 实现在边界处解包；
- `raw`，只用于平台 Adapter 内的准入、日志和错误兜底。

### Message delivery

统一投递端口提供 `reply`、`send`、`edit`、`startTyping`、`splitText`、`formatUserMention` 和 `setMessageStatus`。核心 prompt runtime 以该端口为必需依赖，prompt、进度卡、频道队列、queue report、Settings 过程补发和 slash synthetic prompt 只使用这些语义操作；Discord Adapter 将它们映射到 reply/channel send、消息编辑、typing indicator、Discord 分片、mention 和 reaction。语义状态当前包括 processing、succeeded、cancelled、failed 和 dequeued。

Runtime capability policy 在投递端口外层处理平台能力：无 `messageEdits` 时 edit 不触发底层调用，无 `reactions` 时状态操作不触发底层调用。持续进度卡只在平台支持消息编辑且 delivery port 可用时启用。

extra-info 核心默认模板为 `conversation={conversation}`，并优先读取 normalized conversation envelope。为保持 Discord 零迁移，Discord 组合根使用平台目录中的旧默认模板 `discord_thread={thread}`；用户已经配置的 `{thread}`、`{thread_id}` 与 `{discord_thread}` 占位符继续兼容。

### Notification delivery

统一后台通知端口提供 `sendNotification(conversationId, { content })`，并以布尔返回值表示本次是否成功投递。定时任务和其他无 inbound message target 的后台流程只持有平台无关会话 ID，不读取平台 client 或原生 channel/chat 对象。

当前 Discord 实现通过动态 client getter fetch 对应频道并发送 `{ content }`。项目升级 scheduler 只有在至少一个目标成功投递后才持久化 `lastNotified`；client 尚未就绪、目标不可发送或平台调用失败时不会写入成功状态，因此后续 tick 仍会重试。

### Conversation spawn

统一 conversation spawn 端口负责创建临时子会话及其生命周期操作。核心 `fork`/`side` flow 只处理 provider session、workspace、binding、notice/replay 时序和失败补偿，不直接访问平台 thread SDK。

当前端口提供：

- 判断当前来源是否支持创建子会话；
- 创建、改名、删除、锁定/归档子会话；
- 向子会话发送消息并控制允许触发的用户 mention；
- 读取并规范化父会话最近消息为 `id/text/createdAtMs/actor` history contract，用于回放最近一次 agent 输出；
- 平台文本分片、用户 mention、conversation reference 和队列 synthetic prompt message。

Discord 实现继续使用 thread，并返回 `{ id, raw }` 标准结构。核心内部使用 `childConversation` / `conversationArchive`，对现有调用暂时保留 `childThread` / `discordArchive` 等别名，避免改变已有命令结果和测试接口。未来 Slack/Lark Adapter 可将该语义映射到 thread、reply chain 或平台允许的其他子会话载体。

### Conversation presentation

统一 conversation presentation 端口提供 `getTerm(key, language)`，负责把来源会话、当前来源会话、父来源会话、子会话、父会话、side 会话和会话 ID 等语义术语映射为平台文案。核心 command spec、帮助 formatter 和 fork/side flow 只组合这些语义，不直接决定平台叫 channel、thread、chat 还是 reply chain。

通用默认词汇表使用 `conversation` / `child conversation` / `parent conversation`；Discord 实现返回现有 `Discord channel`、`Discord thread`、`parent Discord thread` 等中英文混合词汇，以保持历史输出逐字一致。后续 Slack/Lark 只需提供各自 presentation，不需要复制命令或 flow 逻辑。

### Text presentation

统一 text presentation 端口提供 `sanitizeDisplayText()`。核心 runtime 默认不改写文本，具体平台可处理会改变显示语义的特殊标记；Discord 实现继续把 `||` 替换为全角竖线，避免实时进度内容被解释为 spoiler。report formatter 的 fork 来源会话引用则复用 `conversationSpawn.formatConversationReference()`，Discord 仍输出 `<#id>`，其他平台可输出自身链接、mention 或普通文本。

### Interaction response

统一交互响应端口提供 `respond`、`update`、`showModal` 和 `defer`。command 核心只生成平台无关 message/modal view，并使用 `visibility: public|ephemeral` 表达可见性；Discord 实现负责：

- 将 view rows 渲染为 Discord components；
- 将 ephemeral 映射为 Discord flag；
- 在 deferred、replied 和初次响应状态之间选择 editReply、followUp 或 reply；
- 对 update 去除无效的 visibility flag；
- 渲染并提交 modal；
- 复用 Discord 网络重试和交互日志标签。

### Command registry

核心命令注册表只声明 command spec：命令名、描述、别名、别名描述和有序 options。option 当前覆盖 string 类型、required 和 choices，不依赖任何平台 SDK。

Discord registry renderer 负责：

- 应用 provider/实例命令前缀和 Discord 32 字符名称限制；
- 将平台命令名还原为核心命令名，并生成 `/command` 引用；
- 将 spec、aliases 和 options 渲染为 `SlashCommandBuilder`；
- 保持现有命令描述、选项顺序和 choices 不变。

Discord registration 只接收 `commandSpecs` 和 renderer，在 ready 事件中生成 REST body 并按 guild 注册。未来 Slack/Lark Adapter 可复用同一份 spec，选择平台原生命令、快捷入口或纯文本降级，而无需让核心构造 Discord builder。

Command spec 可用 `requiredCapabilities` 声明运行前提。capability-aware registry renderer 会在平台注册原生命令前过滤不满足条件的 spec；若平台不支持 slash command，则不注册原生命令，并把命令引用转换为 `!command` 文本入口。

Capability-aware command view policy 会按 `buttons`、`selectMenus` 和 `modals` 处理交互：不支持的按钮/菜单从 view 中移除并追加 `fallbackText`，不支持 modal 时由 interaction response 发送 fallback message。各平台 renderer 因此只处理自身实际支持的视图结构。

## 会话标识与迁移

未来多平台会话键采用带版本的平台限定格式：

```text
platform:v1:<platformId>:<tenantId>:<conversationId>:<threadId>
```

各字段进行 URI 编码，可选字段保留为空。建议映射如下：

| 平台 | tenantId | conversationId | threadId |
| --- | --- | --- | --- |
| Discord | guild ID | channel/thread ID | 空 |
| Slack | team ID | channel ID | thread_ts（无线程则空） |
| 飞书/Lark | tenant key | chat ID | root message ID（按产品策略启用） |

当前阶段只提供构建和解析工具，Discord 仍继续使用原始 `message.channel.id`。在真正启用第二个平台之前，再提供显式、可回滚的数据迁移工具；不得静默改写已有 `sessions.json`。

## 分阶段实施

### 阶段 0：方案与边界基线（已完成）

- 明确平台抽象目标、设计原则、目标目录、契约范围和会话键迁移策略。
- 明确当前交付只建立 Discord 基线，不提前添加 Slack/Lark SDK、配置或业务入口。

验收证据：`30e1df5` 建立本方案文档，并给出平台能力、风险和非目标边界。

### 阶段 1：平台契约与 Discord 端口（已完成）

- 定义 capability、Adapter/Foundation、未来会话键及 command、interaction、delivery、conversation、presentation、security 等契约。
- 实现 Discord command registry/view renderer、inbound normalizer、response/delivery、conversation 和 Foundation 组件。
- 为无原生线程、命令、控件、消息编辑、reaction 或附件的平台提供统一降级策略。

验收证据：`55903a3`、`8af2e8a`；契约、Discord 实现和 capability policy 聚焦测试通过。

### 阶段 2：核心平台无关化（已完成）

- command spec、settings、workspace、onboarding、retry 和 progress 只生成平台无关 view。
- message/interaction 在入口规范化；prompt、queue、session、附件和 history 统一读取 normalized context。
- runtime 投递、项目升级通知、fork/side conversation lifecycle、conversation presentation 和 security policy 全部改走平台端口。
- 使用边界测试阻止 Discord Builder、原始 interaction/message 字段、thread API、mention/reaction 和直接网络投递重新泄漏到核心。

验收证据：`ee2a4d9`、`27380e7`、`34c3b8f`、`c212fb8`、`18414af`；本页“增量实现验证记录”覆盖每次迁移的行为与边界回归。

### 阶段 3：Foundation 统一组合与 Discord 回归（已完成）

- `createAppContext()` 从单一 Foundation 获取 pre-core 平台服务，并由同一 Foundation 创建最终 Adapter。
- `src/index.js` 使用 Discord Foundation 完成生产组合；启动生命周期继续只消费统一 Adapter。
- 保留原 factory 注入和结果别名作为兼容面，避免一次性破坏现有测试及调用方。
- 保持 Discord session key、持久化 schema、环境变量、命令注册 JSON、启动方式和用户可见行为不变。

验收证据：`03efc7c`；`test:platform-foundation`、`test:platform-inputs`、`test:platform-security`、`test:platform-presentation` 和 `test:platform-notifications` 当前均通过。

### 阶段 4：第二平台准入准备（下一阶段）

- 把 Discord 默认 factory 和兼容参数进一步收口到 Discord 启动/组合边界，使平台无关 AppContext 不需要了解具体平台构造器。
- 盘点并分批移除生产路径不再需要的 `slash-command-surface.js` facade、raw message fallback 和 `childThread` / `discordCleanup` / `discordArchive` 别名；删除前先迁移调用方并保留回归保护。
- 将现有平台契约测试整理为可供任意 Adapter 复用的 conformance suite，至少覆盖消息、命令、取消、附件、能力降级、子会话和错误恢复。
- 决定第二平台启用时的 session 数据隔离、Node.js 22 基线、平台配置选择和限定会话键迁移门槛。
- 完成一次不依赖 Discord SDK 对象的核心 smoke fixture，作为进入 Slack 实现的硬性验收门。

验收标准：新增平台只需提供 Foundation/Adapter 和启动配置，不修改 prompt、queue、session、command、settings、workspace 或 fork/side 核心；Discord 全量回归继续通过。

### 阶段 5：Slack Adapter（未开始）

- 引入并隔离 Slack SDK，默认使用 Socket Mode。
- 支持 app mention、DM、频道消息、slash command、Block Kit action 和 modal。
- 使用 team/channel/thread_ts 建立稳定会话标识。
- 实现 Slack 消息长度、更新频率、ack 时限、重试和事件去重策略。
- 补充 Slack manifest、最小权限文档和独立集成测试。

### 阶段 6：飞书/Lark Adapter（未开始）

- 引入并隔离官方 Node SDK，默认使用 WebSocket 长连接。
- 同时兼容飞书与 Lark 域名/区域配置。
- 支持群聊 @、私聊、消息、附件、命令替代入口和卡片 action。
- 使用 tenant/chat/root message 建立稳定会话标识。
- 实现事件验签/解密（若启用回调模式）、事件去重、卡片更新和频控策略。
- 补充应用权限清单、事件订阅文档和独立集成测试。

### 阶段 7：迁移与统一运维（未开始）

- 增加 `BOT_PLATFORM=discord|slack|lark` 或等价的实例级配置。
- 支持同一代码库启动多个平台实例，并保持锁文件、数据文件和日志标识隔离。
- 提供旧 Discord key 到新限定 key 的 dry-run、备份、迁移和回滚工具。
- 增加各平台健康检查、连接状态、速率限制和投递失败指标。

## 配置规划

配置按平台命名空间隔离，敏感凭证只从环境变量或外部 secret store 读取。建议后续变量：

```text
BOT_PLATFORM=discord|slack|lark

SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_SIGNING_SECRET=       # 仅 HTTP 回调模式需要

LARK_APP_ID=
LARK_APP_SECRET=
LARK_DOMAIN=feishu|lark
```

allowlist 也应使用平台限定配置，避免相同裸 ID 在不同平台间误匹配。多实例部署时，session 数据文件和 single-instance lock 必须按平台或实例名隔离。

## 测试策略

- 契约测试：Adapter 必填字段、capability 类型和无效实现拒绝。
- 映射测试：会话键编码、解析、可选字段和非法输入。
- Adapter 单测：工厂调用顺序、依赖透传和强制交叉绑定。
- Discord 回归：原有 entry handler、lifecycle、reply、command 和 app context 测试。
- 后续平台契约套件：同一组消息、命令、取消、附件和错误场景分别运行在每个 Adapter fixture 上。
- 少量真实平台 smoke test：连接、接收消息、回复、取消和重连；凭证不进入仓库。

## 风险与约束

- prompt 主流程、command UI、interaction response、command registry、interaction 输入、运行时 capability、session topology 和 fork/side conversation lifecycle 已建立平台边界；Discord entry handler 的准入、超时日志与错误兜底仍合理保留 Discord SDK 语义。进入新平台前仍需分别设计 Slack/Lark 的身份、权限、事件确认、限流和 thread/reply-chain 映射，不能直接复用 Discord SDK 假设。
- Slack 的 `ack` 时限、消息更新频控与 Discord 不同；飞书/Lark 的卡片、用户 ID 类型和权限模型也不同，不能用字段重命名代替适配。
- 跨平台线程语义不同，需要以 conversation/thread 映射策略为准，不能强制所有平台模拟 Discord thread。
- 启用 Slack/Lark SDK 前应将生产 Node.js 基线升级到 22 LTS。当前 Slack Bolt 5 系列至少要求 Node.js 20；本阶段不修改 Node 版本或依赖。

## 当前明确不做

- 不添加 Slack 或飞书/Lark SDK。
- 不新增 Slack/Lark 环境变量、事件、命令、卡片或部署入口。
- 不重命名项目，不批量移动现有 Discord 文件。
- 不修改 Discord session key 或已有持久化数据。
- 不为平台抽象重写 provider runner、session、queue 或 workspace lock 核心语义。
