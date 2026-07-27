# 多平台 Adapter 演进方案

## 背景与目标

本项目目前以 Discord 作为消息入口，但核心能力——会话状态、Provider runner、频道队列、工作区绑定、跨进程锁、设置与安全策略——并不应绑定到单一聊天平台。

本方案的目标是在保留 Discord 现有行为的前提下，引入稳定的平台抽象层，随后逐步支持 Slack 和飞书/Lark。截至 2026-07-27，平台契约、Discord Adapter、核心平台边界、统一 Foundation 组合和可复用 conformance suite 已落地；飞书/Lark 的功能实现、自动化回归、真实凭证 readiness、成功表单保存和私密交互跨重启 smoke 已完成。当前工作重点已从功能开发转为剩余生产验收、运维收口和提交发布，Slack 仍是独立后续阶段。

## 实施状态

本节以本地提交 `30e1df5..97ebfb7` 及 2026-07-27 飞书/Lark 阶段性提交为同步基线。原先统一归在“阶段 2 进行中”的工作，现按实际依赖关系重排如下：

| 阶段 | 状态 | 对应提交 | 当前结果 |
| --- | --- | --- | --- |
| 阶段 0：方案与边界基线 | 已完成 | `30e1df5` | 明确 Adapter 目标架构、能力模型、会话迁移约束及“不提前引入 Slack/Lark”的范围。 |
| 阶段 1：平台契约与 Discord 端口 | 已完成 | `55903a3`、`8af2e8a` | 平台契约、capability policy、Foundation、统一输入/输出端口及 Discord 实现已建立。 |
| 阶段 2：核心平台无关化 | 已完成 | `ee2a4d9`、`27380e7`、`34c3b8f`、`c212fb8`、`18414af` | command/UI、inbound context、runtime delivery、conversation lifecycle/presentation 和 security 已改为消费平台端口。 |
| 阶段 3：Foundation 统一组合与 Discord 回归 | 已完成 | `03efc7c` | `createAppContext()` 通过单一 Foundation 获取平台服务并创建 Adapter，Discord 启动、配置、session 与用户可见行为保持兼容。 |
| 阶段 4：第二平台准入准备 | 已完成 | `97ebfb7` | 已清理过渡 facade/别名和 raw fallback，把 Discord 组合收口到启动边界，并补齐可复用 Adapter conformance suite、无 Discord SDK 核心 smoke 与准入决策。 |
| 阶段 5：Slack Adapter | 未开始 | — | Slack 仍是独立后续阶段，其 Node.js 基线单独决策。 |
| 阶段 6：飞书/Lark Adapter | 功能完成，验收中 | 本阶段提交 | Node.js 18 消息、原生命令、机器人菜单、卡片/表单、私密响应、reaction、健康指标、reply-chain fork/side 和 Webhook 已完成；readiness、成功表单和私密跨重启 smoke 已通过，尚待无权限用户与公网 Webhook 真实验收。 |
| 阶段 7：多平台迁移与统一运维 | 进行中 | 本阶段提交 | 已启用平台选择、限定会话键、平台/实例数据隔离及平台中立健康读取；Lark 已接入连接/投递指标，Discord key 迁移与其他平台指标仍待实现。 |

当前已完成能力包括：

- 统一 command spec/view、interaction response、message/notification delivery、inbound message/interaction envelope、conversation spawn/presentation/security 和 text presentation 契约。
- command、prompt、queue、settings、workspace、fork/side、session topology 和 project upgrade scheduler 已通过平台端口工作；Discord 原始对象只在入口、投递、安全推断和 Adapter 内的平台操作边界使用。
- `threads`、`slashCommands`、`buttons`、`selectMenus`、`modals`、`messageEdits`、`reactions`、`attachments` 已有显式 capability 和降级策略。
- 生产组合根可按 `BOT_PLATFORM=discord|lark` 选择 Foundation；现有 Discord session key、默认 `sessions.json`、环境变量、命令 JSON、启动方式和主要用户可见文案保持不变。
- `slash-command-surface.js`、raw message fallback、conversation history `author` 别名以及 `childThread` / `discordCleanup` / `discordArchive` 等迁移期兼容面已移除，边界测试阻止其回流。
- `src/platforms/lark/` 已实现 Foundation/Adapter、消息输入输出、访问控制、安全描述、通知、生命周期和文本能力降级；官方 SDK 支持 WebSocket 长连接和验证后的 Webhook 回调。
- Settings、Onboarding、Workspace Browser、workspace 冲突与 Retry command view 已映射为 Lark 原生交互卡片；SDK/CLI 均接收 `card.action.trigger` 并路由回共享 component handlers。
- 共享 modal view 已映射为 Card 2.0 `form` + `input` + submit button；SDK raw event 与 CLI `form_value` 均规范化为共享 modal interaction，并路由回 Settings/Goal modal handlers。
- `application.bot.menu_v6` 已接入双 transport；菜单 `event_key` 规范化为共享 command name，先解析操作者私聊 chat，再复用 command router 和原位卡片响应。
- 版本化应用基线声明 `status`、`settings`、`progress`、`queue`、`cancel`、`new`、`onboarding` 七个机器人菜单事件键；readiness 会逐项检查已发布版本，避免任意空壳或错误命令菜单被误判为可用。
- 群聊卡片产生的非表单 `ephemeral` 响应已映射为操作者私聊卡片；卡片内嵌原 chat/reply-chain 的限定上下文，进程重启丢失内存 target cache 后仍能恢复原 session，且共享卡片不会被私密结果或权限拒绝覆盖。来自已有私聊卡的非表单私密响应原位更新该私聊卡；Card 2.0 表单成功提交后保留原位确认并发送新的 Card 1.0 Settings 卡。
- `npm run check:lark` 复用生产配置解析执行 secret-free 部署预检；可选 `--verify-credentials` 只读验证 CLI profile 或 SDK tenant token、bot info 和版本化 tenant-scope 基线，不启动消费者或发送消息。2026-07-27 当前环境的默认 CLI profile 已通过凭证与 bot identity 检查，权限基线为 9/9，并配置了当前应用作用域内的限制性用户 allowlist。
- 真实凭证预检要求 chat/tenant/user allowlist 至少配置一项；空 allowlist 不会截断 tenant scopes、线上版本、事件、菜单和 slash command 的只读审计，但最终 readiness 必定失败，避免开放访问被误判为可部署。
- 版本信息可读取但原生 slash command 注册表不可读取时，readiness 现在明确失败并指出 `application:app_slash_command:read`，不再把缺失的自动证据降级为人工确认。
- `npm run sync:lark-commands` 默认只读比较 provider 对应的原生命令并核对 read/write provisioning scopes；`--dry-run` 使用当前 `lark-cli` 逐条验证整批 create/update 请求，`--apply` 只有在权限、100 条容量预检和全部请求预演通过后才写入，并且永不自动删除额外命令。
- 当前应用的 slash-command provisioning scopes 为 2/2；46 条命令已按 dry-run 后 additive `--apply`，随后只读复核为 46/46 matched，missing/outdated/extra 均为 0，剩余容量 54/100。
- AppContext 通过延迟健康读取器组合 Adapter lifecycle 与 message delivery 指标；Lark SDK/CLI/Webhook 都提供统一连接快照，`status` 显示连接状态、重试、自愈重启、投递成功/失败/进行中和最近失败。
- 本机模式可用 `LARK_TRANSPORT=cli` 复用官方 `lark-cli` 的加密持久凭证和事件总线；`auto` 在未提供 App ID/Secret 时自动选择 CLI，服务器仍可显式选择 SDK。
- 服务器可显式选择 `LARK_TRANSPORT=webhook`，通过官方 dispatcher 验证 verification token；配置 encrypt key 后再验证签名并解密 encrypted payload。本地 listener 默认绑定 loopback，支持固定 path、body limit，以及请求头、完整请求和 keep-alive 超时边界。
- Webhook transport 提供与回调 POST 路径分离的 `GET /healthz` 运维探针，只返回连接状态和平台/transport 标识，不暴露凭证或事件内容。
- `smoke:lark-webhook-live` 为生产 Webhook 提供只读 preflight 和显式 prepare/observe/verify：challenge 必须通过校验并成功生成响应，签名证据必须来自实际签名头，加密请求必须成功完成 challenge 或 dispatcher；共享 handler 也必须成功处理真实消息、原生 slash、菜单或卡片 action 后才记录 `0600` 布尔回执。runtime boot fingerprint 与本机/公网健康变化用于区分应用和反向代理恢复；状态不保存 URL、签名、正文或平台标识。
- SDK safety pipeline 与平台入口共同按 message/event ID 做有界去重；CLI、Webhook 重投以及机器人菜单重试不会重复进入 command/prompt 核心。
- Lark 会话从首版使用 `platform:v1:lark:<tenant>:<chat>:<thread>`；reply chain 以 canonical `root_id` 作为子会话键，即使事件同时提供 `thread_id` 也保持稳定。session、进程锁、workspace lock 和 project-upgrade 状态均按平台与实例隔离。
- 群聊已启用 `threads` capability，将共享 Codex/Claude fork 和 Codex side lifecycle 映射为新根消息下的 reply chain；私聊明确降级为不可创建子会话。
- 任意新 Adapter 可复用同一 conformance suite 验证消息、命令、取消、附件、能力降级、子会话和错误恢复；Discord 与 Lark driver 均已接入，synthetic Foundation smoke 明确证明 AppContext 组合不需要 Discord SDK 对象。

### 2026-07-25 Lark Node.js 18 消息 MVP

- 使用官方 `@larksuiteoapi/node-sdk@1.71.1` 的 `createLarkChannel()` 和 WebSocket transport，在 Node.js `v18.17.1` 完成安装、导入与无网络 SDK 组合验证。
- 支持群聊 @、私聊、普通消息、文本命令、回复链会话、消息编辑、通知投递、附件资源下载、Codex 原生图片输入及长连接自愈。
- 首版当时已启用原生 button、select、message edit、reaction 和 attachment；后续阶段又补齐 Card 2.0 modal 等价能力、群聊 reply-chain 子会话及原生 slash command 注册与普通消息路由。
- 已增加 Lark 专用 foundation、conformance、input、delivery、security、lifecycle、entry handler 和平台实例隔离测试；真实应用凭证 smoke 仍待部署环境执行。
- 最终回归：`npm run test:lark` 25/25、`test:platform-foundation` 13/13、`test:platform-conformance` 14/14、`test:platform-inputs` 188/188、`test:platform-security` 24/24、`test:platform-notifications` 19/19、`test:platform-topology` 45/45、`npm run test:progress` 705/705。
- `npm run check:reply-fallback`、全部 `src/`/`scripts/`/`test/` JavaScript 语法检查和 `git diff --check` 通过；使用 dummy 凭证的完整启动组合能进入 Lark SDK 鉴权并按预期失败，未执行真实凭证连接 smoke。

### 2026-07-26 Lark 原生卡片交互

- command message view 已映射为飞书交互卡片，支持 button、`select_static`、禁用控件过滤及原卡片更新；Settings、Onboarding、Workspace Browser、workspace 冲突和 Retry 共用现有核心 handler。
- SDK transport 直接消费 `cardAction`，CLI transport 同时消费 `im.message.receive_v1` 与 `card.action.trigger`；两者都规范化为统一 button/select interaction envelope。
- message delivery 已支持卡片发送/更新，并把 processing、succeeded、cancelled、failed、dequeued 映射到飞书 reaction；CLI transport 补齐对应 raw API 操作。
- 新增 `docs/lark-app-config.v1.json` 权限/事件基线和真实凭证 smoke checklist；真实应用连接 smoke 仍待部署环境执行。
- 当前回归：`npm run test:lark` 105/105、`test:platform-foundation` 14/14、`test:platform-conformance` 14/14、`test:platform-inputs` 200/200、`test:platform-security` 25/25、`test:platform-notifications` 26/26、`test:platform-topology` 53/53、`test:platform-presentation` 196/196、`npm run test:progress` 381/381。

### 2026-07-26 Lark Card 2.0 表单交互

- Lark `modals` capability 已启用，但平台呈现为原消息内嵌 Card 2.0 表单，而不是 Discord 弹窗；共享 `createCommandModalView()` 无需复制业务逻辑。
- 表单按钮通过 `name` 携带 modal ID，`form_value` 规范化为 `modal.getField()`；Settings model/profile/compact threshold 和 Goal modal submit 复用现有共享 handlers。
- 打开表单和校验失败都更新原卡片；保存成功时旧 Card 2.0 表单原位变为确认卡，再发送新的 Card 1.0 Settings 卡。这样既保留校验/重试，又避免飞书更新接口不支持 Card 2.0 原位降级到 Card 1.0。表单 schema 已通过当前 `lark-cli` dry-run，SDK/CLI 两条回调路径均有自动化覆盖。
- 修复 Settings、Onboarding、Workspace Browser、workspace busy 和 Retry 等 user-bound component ID 只接受 Discord 数字 ID 的问题，现支持飞书 `ou_...` open ID。

### 2026-07-26 Lark 机器人菜单命令入口

- SDK transport 在官方 channel dispatcher 上补充 `application.bot.menu_v6`，CLI transport 增加同名 event consumer；两端输出统一为 bot-menu event。
- 由于飞书菜单事件不携带 chat ID，Adapter 先按操作者 `open_id` 发送处理中卡片，并读取返回消息所属私聊 chat，再建立与普通私聊一致的 conversation key。
- 菜单 `event_key` 直接使用共享命令名，命令结果更新原处理中卡片；未知命令、会话 allowlist 拒绝和执行错误都会显示在同一张卡片上。
- `npm run check:reply-fallback`、全部 JavaScript 语法检查、`git diff --check` 及 `lark-cli` interactive-card dry-run 通过。

### 2026-07-26 Lark 平台健康与投递指标

- 平台中立健康读取器在不扩大 Foundation/Adapter 必选契约的前提下，延迟读取最终 lifecycle 与 message delivery 快照；未提供指标的 Discord 组合保持原 `status` 输出。
- SDK transport 读取官方 `getConnectionStatus()`，CLI transport 暴露同构的 idle/connecting/connected/reconnecting/failed 状态、consumer 数量和重连计数。
- Lark lifecycle 记录连接尝试、退避重试、自愈重启、下次重试和最近错误；`SIGTERM`/`SIGINT` 的优雅断开与自愈开关解耦，退出会取消待执行重试并禁止反向自愈。message delivery 记录 send/reply/edit/reaction 的成功、失败、进行中及最近失败。
- `status` 中英文报告已显示平台连接和消息投递摘要；最新专项和进度回归结果见后面的 reply-chain/Webhook 验证记录。

### 2026-07-26 Lark reply-chain fork/side 子会话

- `threads` capability 已启用；群聊中的共享 Codex/Claude fork 和 Codex side flow 会先发送新的根消息，再把后续消息投递到以该 `root_id` 标识的 reply chain。
- inbound 事件同时含 `root_id` 和 `thread_id` 时优先使用 canonical `root_id`，避免创建根消息时尚未知的 `omt_...` 导致 session key 漂移。
- 根消息编辑承担 rename 等价语义；fork/side 绑定前失败会 recall 根消息，side close 则编辑根消息写入关闭标记。
- 卡片 action 会从发送期 target cache 或消息查询恢复 root/thread 上下文，避免在子会话中点击设置时误修改父会话。
- 私聊 `canSpawn=false`，不会伪造平台不存在的子会话；群聊 fork 与 side 创建/绑定/关闭均有 Lark 专项集成覆盖。

### 2026-07-26 Lark Webhook 回调

- 新增 `LARK_TRANSPORT=webhook`，复用官方 SDK dispatcher 处理事件、机器人菜单和卡片 action；`auto` 不会隐式选择 Webhook。
- HTTP 入口固定 path、仅接受 POST、限制 body 大小并默认监听 `127.0.0.1`；部署时由反向代理提供公网 TLS。
- dispatcher 始终验证 verification token；配置 encrypt key 时验证 `x-lark-signature` 并使用 AES-256-CBC 解密 encrypted payload。URL verification challenge 由同一入口返回。
- 消息、卡片 action 和机器人菜单按稳定事件 ID 使用 12 小时、最多 5000 项的默认内存窗口去重，并可通过环境变量调整。
- 验签、token、解密、challenge、错误请求泛化和 body limit 均有自动化测试；真实公网代理和开放平台回调仍属于真实凭证 smoke。

### 2026-07-26 Lark 私密交互响应

- 群聊卡片产生的非表单 `ephemeral` 响应不再覆盖共享卡片，而是发送到操作者与 bot 的私聊；权限和访问控制拒绝也使用同一私密投递语义。
- 私聊卡片的 button、select 和 Card 2.0 submit action 内嵌原群聊/reply-chain 的限定会话上下文，发送期 target cache 丢失或进程重启后仍能恢复原 session；来自现有私聊卡的非表单私密响应直接编辑实际私聊消息，不再依赖关联回复。
- Card 2.0 表单继续在当前卡片原位打开并保留字段校验、修正及重试流程；成功提交时原位确认并发送新的 Settings 卡。从私聊卡片打开的表单仍携带原会话上下文。
- 上下文恢复只接受自洽的 Lark 限定 key；malformed JSON、Discord key 以及 tenant/chat/root 冲突值会被忽略并安全降级到实际交互所在私聊。
- 自动化覆盖共享卡片不被私密响应或权限拒绝覆盖、无内存 cache 的 button/modal 上下文恢复及非法上下文降级；当前完整回归数字见本页“Lark 原生卡片交互”记录。

### 2026-07-26 Lark 部署预检

- `src/lark-runtime-config.js` 成为生产启动和预检共用的配置解析源；选中 transport 的 placeholder 凭证、domain、Webhook callback/health path、port/body limit 及各安全/投递数值会在启动前给出明确错误，不再静默回退。
- `npm run check:lark` 只检查有效配置和本地 SDK/CLI；`--verify-credentials` 对 CLI 执行 `auth status --verify --json` 并读取 tenant scopes，对 SDK/Webhook 获取 tenant token 后读取 bot info 与 tenant scopes，全程不启动事件消费者、Webhook listener 或消息发送。
- JSON 和文本报告只输出 transport、布尔凭证状态、非敏感 endpoint、数值边界与 allowlist 数量；API token、App Secret、App ID、bot/user ID 和 CLI profile 名称不会进入报告或错误文本。
- 该阶段首次检查时，默认 CLI profile 的只读凭证、bot capability 和 bot open ID 可用性已通过，但 tenant-scope 基线为 8/9，缺少失败补偿所需的 `im:message:recall`，且 allowlist 为空。后续已补齐权限和限制性用户 allowlist；2026-07-27 的再次核验为 9/9 且 readiness 全部通过。
- 配置、readiness、凭证脱敏、provider override、生产组合边界和默认文本分片限制均有自动化覆盖；真实凭证预检还会只读核对线上版本、接入方式、发布事件和机器人菜单，开放平台未返回的 card callback 列表会保留为显式人工检查；完整回归数字见本页“Lark 原生卡片交互”记录。

### 2026-07-27 Lark Settings 与私密跨重启收口

- 修复 `lark-cli` button callback 携带 `option: null` 时被误判为 select 的问题：CLI normalizer 省略空 option，平台 inbound normalizer 只在 option 非空或 action tag 为 select 时生成 select interaction。
- 新增 Card 2.0 completion renderer 与 message-delivery `completeModal` 能力；capability policy 在支持消息编辑时执行“原 Card 2.0 确认 + 新 Card 1.0 面板”，不支持编辑的平台安全降级为新消息。
- 真实 Settings 复测完成 compact threshold 非默认值保存、最新 Settings 卡刷新和恢复默认值，确认持久化 override 已清除且无 handler/schema 错误。
- Onboarding workspace browse 在 CLI transport 上被正确识别为 button，私聊卡内嵌的原群聊/reply-chain 上下文能恢复并打开真实 Workspace Browser。
- 真实进程替换后点击旧 Workspace Browser 控件，内存 state 按预期缺失；原私聊卡被原位更新为无控件过期提示，群聊新增消息为 0，workspace、runner session、Codex thread 与 provider 绑定保持不变。
- 为 card routing 与 Workspace Browser 增加脱敏诊断：只记录 interaction kind、component 前缀/长度和 state/response 布尔值，不记录 action payload、标识或消息正文。
- 完整回归结果更新为 `npm run test:lark` 120/120、`npm run test:progress` 844/844，失败、取消和跳过均为 0。

### 2026-07-27 飞书/Lark 阶段性提交与验收快照

本次阶段性提交收口以下功能边界：

- 平台组合：`BOT_PLATFORM=lark` 可创建 Lark Foundation/Adapter；平台与实例共同隔离 session、single-instance lock、workspace lock、project-upgrade 状态和健康标识，Discord 默认文件名与行为保持不变。
- 接入方式：支持官方 SDK WebSocket、复用加密持久凭证的 `lark-cli` WebSocket，以及显式启用的 Webhook dispatcher；三种 transport 共用消息、卡片 action、机器人菜单、去重、生命周期和投递语义。
- 消息与命令：支持私聊、群聊 @、普通 prompt、文本命令、46 条 provider 前缀原生 slash commands、事件型机器人菜单、消息回复/编辑、长文本分片和通知投递。
- 原生交互：共享 command view 可渲染为按钮、下拉和 Card 2.0 表单；支持原位更新、操作者私聊中的非表单私密响应、跨重启恢复来源会话上下文，以及权限拒绝不覆盖群聊共享卡片。
- 会话与附件：使用 tenant/chat/root message 限定会话键，支持群聊 reply-chain fork/side、附件资源下载和 Codex 原生图片输入；私聊对不支持的子会话能力显式降级。
- 可靠性与安全：支持访问 allowlist、mention-only 策略、机器人消息过滤、陈旧事件窗口、有界去重、发送重试、断线重连/自愈、优雅退出、Webhook token/签名/加密验证、body limit 和 HTTP 超时。
- 运维工具：提供 secret-free `check:lark`、只读真实凭证/已发布应用核验、原生命令 drift 审计及显式同步工具；报告不输出凭证、应用 ID、命令 ID、profile 名称或用户标识。

本次提交前的验证结果：

- `npm run test:lark`：120/120 通过。
- `npm run test:progress`：844/844 通过。
- `test:platform-foundation` 与 `test:platform-conformance`：分别 14/14、14/14 通过。
- `test:platform-inputs`、`test:platform-security`、`test:platform-presentation`、`test:platform-topology`：分别 201/201、25/25、196/196、54/54 通过。
- `npm run check:lark -- --verify-credentials --json`：合并后通过；tenant scopes 9/9、事件 2/2、卡片回调 1/1、机器人菜单事件键 7/7、原生 slash commands 46/46，且无 errors/warnings。Pi/OMP session aliases 对应的 4 条命令已在整批 dry-run 通过后 additive apply。
- 真实隔离私聊已覆盖 `!status` 收发、Settings 卡片及原位更新、select/Card 2.0 回调、机器人菜单、`/cx_status`、普通 prompt、带参数原生命令、未知 slash-path 回退和无效 Codex profile 校验路径。
- 成功表单保存已覆盖 compact threshold 的非默认值持久化、Card 2.0 原位确认、新 Settings 卡刷新及恢复默认值；CLI button 的空 option 兼容也已通过真实 Onboarding/Workspace Browser 点击验证。
- 私密响应跨重启已覆盖真实进程替换、旧卡过期分支、私聊原位更新、群聊零新增及原 session 绑定不变。
- 真实隔离群聊已覆盖 @/未 @、图片下载与原生图片理解、长任务取消/reaction、fork/side reply chain，以及 side 关闭后同一原生卡片根消息原位写入锁定标记；飞书历史列表 `230027` 时 fork 的可选最近输出重放会安静降级，不影响 fork 成功报告。
- 受控断网复测发现临时代理可被启动期大小写补齐固化到 `.env`；现已改为默认只修复当前进程环境。新源码重启后项目代理键保持为 0、CLI consumer 无代理且私聊 `!status` 再次取得关联回复。
- `git diff --check` 通过；提交范围不包含 App Secret、token、测试 chat ID 或用户 ID。

阶段边界：上述结果证明当前实现具备试运行条件，但不等同于完整生产验收。成功表单保存和私密响应跨重启已完成；无权限用户的私密拒绝与真实公网 Webhook 仍按部署检查清单逐项验收。真实断网重连、`!status` 投递指标和新增 4 条原生 slash commands 的远端 additive sync 已完成。

### 2026-07-25 阶段 4 验证

- `npm run test:platform-foundation`：12/12 通过。
- `npm run test:platform-conformance`：7/7 通过。
- `npm run test:core-platform-smoke`：1/1 通过。
- `npm run test:platform-security`：20/20 通过。
- `npm run test:platform-inputs`：182/182 通过。
- `npm run test:platform-presentation`：192/192 通过。
- `npm run test:platform-notifications`：16/16 通过。
- `npm run test:platform-topology`：40/40 通过。
- `npm run test:progress`：680/680 通过；同时修复 Codex goal grace timer `unref()` 导致的 5 个 `cancelledByParent`，`test/runner-executor.test.mjs` 现为 16/16。
- `npm run check:reply-fallback`、全部 `src/**/*.js` 语法检查和 `git diff --check` 通过。
- 下列 2026-07-24 记录继续保留每次增量实现时的完整回归证据。

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
- `npm run check:reply-fallback`、全部 `src/**/*.js` 语法检查和 `git diff --check` 均通过；该阶段当时尚未加入第二个平台实现。

### 2026-07-24 text presentation 与 platform foundation 验证记录

- report formatter 新增 `formatConversationReference()` 注入，fork 来源不再在核心拼接 `<#id>`；Discord composition 继续通过 conversation spawn renderer 输出原有 channel mention。
- 新增 text presentation 契约并列入 Foundation/Adapter 必填组件；核心 runtime 默认保持文本原样，Discord 实现显式中和 `||` spoiler 标记，现有进度卡显示不变。
- 新增 platform foundation 契约与 Discord foundation，统一提供 capability-aware command registry/view、interaction response、message/notification delivery、conversation spawn/presentation/security 和 text presentation。
- `createAppContext()` 只从 foundation 获取 pre-core 平台服务，并调用同一 foundation 的 `createAdapter()` 完成 access、entry 与 lifecycle 组合；仍保留原 factory 注入兼容面。
- `test:platform-foundation`：11/11、`test:platform-presentation`：192/192、`test:platform-security`：20/20、`test:platform-inputs`：182/182 通过。
- 排除仓库既有 `test/runner-executor.test.mjs` 挂起问题后的全量项目回归：689/689 通过。
- 该阶段当时未新增第二平台 SDK 或入口；Discord session key、持久化格式、环境变量和启动方式保持不变。

## 设计原则

- 核心运行时继续复用，不为每个平台复制 session、queue、runner 或 workspace lock。
- 平台差异集中在 Adapter 内，包括鉴权、事件接入、交互响应、消息投递和客户端生命周期。
- 平台能力显式声明。上层功能按 capability 降级，不能假设每个平台都支持 Discord 的线程、按钮或 modal。
- Discord 零迁移。当前基线保持现有频道 ID session key、`sessions.json`、环境变量和启动方式不变。
- 渐进式拆分。组合边界、主要核心迁移和第二平台准入加固已完成；Lark 已从消息 MVP 演进到原生卡片控件、表单、reply-chain 子会话与 Webhook，Slack 继续按独立阶段演进。
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
    lark/                  # 已实现
      adapter.js
      foundation.js
      inbound-event.js
      message-delivery.js
      conversation-spawn.js
```

Platform foundation 在创建核心 runtime 前提供 capability、命令/UI renderer、投递、conversation 与 presentation 端口，并暴露 `createAdapter()` 完成 access policy、entry handler 和 lifecycle 的后半段组合。`createAppContext()` 只消费显式传入的 Foundation；Discord Foundation 只在 `src/index.js` 启动组合根创建。

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

消息进入核心前会由 envelope 构造 normalized message context。actor ID、conversation、conversation target、conversation ID、attachments 和 reply reference 只通过统一 accessor 读取 normalized envelope/context；`responseTarget` 仅供平台 delivery 在边界处解包。核心 accessor 不再读取原始 Discord `author`、`channel`、`reference` 或 collection-shaped `attachments`。

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

Discord 实现继续使用 thread，并返回 `{ id, raw }` 标准结构。核心内部只使用 `childConversation` 和平台无关的清理/归档结果，不再暴露 `childThread`、`discordCleanup` 或 `discordArchive` 别名。Lark 已将该语义映射到群聊 reply chain；未来 Slack 可映射到 thread 或平台允许的其他子会话载体。

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

Lark 从首个可运行版本起使用上述限定键，Discord 仍继续使用原始 `message.channel.id` 以保持零迁移。若后续统一 Discord 会话键，必须提供显式、可回滚的数据迁移工具；不得静默改写已有 `sessions.json`。

## 分阶段实施

### 阶段 0：方案与边界基线（已完成）

- 明确平台抽象目标、设计原则、目标目录、契约范围和会话键迁移策略。
- 明确阶段 0 当时只建立 Discord 基线，不在契约尚未稳定时提前加入第二平台业务入口。

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

### 阶段 4：第二平台准入准备（已完成）

- Discord 默认 factory、capability policy 和 Foundation 创建已收口到 `src/index.js` 与 Discord Adapter/Foundation；平台无关 AppContext 只接受显式 `platformFoundation`。
- 已删除生产路径不再需要的 `slash-command-surface.js` facade、raw message fallback、conversation history `author` 别名和 `childThread` / `discordCleanup` / `discordArchive` 结果别名。
- `test/support/platform-conformance.mjs` 提供任意 Adapter 可复用的 conformance suite，Discord driver 已覆盖消息、命令、取消、附件、能力降级、子会话和错误恢复。
- 已确定第二平台启用时的 session 数据隔离、平台配置选择和限定会话键迁移门槛；Node.js 基线改为按平台依赖分别决策，见下方“第二平台准入决策”。
- `test/core-platform-smoke.test.mjs` 使用 synthetic Foundation 调用真实 `createAppContext()`，全程不构造 Discord SDK 对象。

验收标准：新增平台只需提供 Foundation/Adapter 和启动配置，不修改 prompt、queue、session、command、settings、workspace 或 fork/side 核心；Discord 全量回归继续通过。

#### 第二平台准入决策

- **Node.js 基线**：Discord 与 Lark 接入均继续兼容 Node.js 18，本次 Lark 验证环境为 `v18.17.1`，官方 SDK `1.71.1` 可安装、导入并组合 WebSocket channel。Slack Adapter 的 SDK 版本和生产基线单独评估；若采用要求 Node.js 20+ 的 Slack Bolt 版本，可再统一升级到 Node.js 22 LTS，但这不再阻塞 Lark。
- **会话键**：第二平台从首个版本起必须使用 `buildConversationKey()` 生成 `platform:v1:<platform>:<tenant>:<conversation>:<thread>` 限定键，不允许先写裸 channel/chat ID 再补迁移。现有 Discord 继续使用裸 channel ID，保持零迁移；任何 Discord 限定键迁移都必须提供 dry-run、备份、显式执行和回滚，不得静默发生。
- **数据与运行隔离**：第二平台及后续多实例的 session 数据文件、single-instance lock、workspace lock 命名空间和日志实例标识必须同时包含 `platformId` 与稳定 `instanceId`。不同平台或实例不得共用可写 session 文件、进程锁或无法区分来源的日志标签。
- **平台选择配置**：已启用 `BOT_PLATFORM=discord|lark` 和 `BOT_INSTANCE_ID`。选择结果同时驱动 Foundation、凭证、数据/锁路径、project-upgrade 状态和日志标识；Discord 默认实例继续保留原文件名与启动方式。
- **准入门槛**：第二 Adapter 合并前必须通过同一 conformance suite 和 synthetic core smoke，并证明无需修改 prompt、queue、session、command、settings、workspace 或 fork/side 核心模块。

### 阶段 5：Slack Adapter（未开始）

- 引入并隔离 Slack SDK，默认使用 Socket Mode。
- 支持 app mention、DM、频道消息、slash command、Block Kit action 和 modal。
- 使用 team/channel/thread_ts 建立稳定会话标识。
- 实现 Slack 消息长度、更新频率、ack 时限、重试和事件去重策略。
- 补充 Slack manifest、最小权限文档和独立集成测试。

### 阶段 6：飞书/Lark Adapter（功能完成，验收中）

已完成：

- 引入并隔离官方 Node SDK，默认使用 WebSocket 长连接，同时兼容 `feishu` 与 `lark` domain。
- 支持群聊 @、私聊、普通消息、文本命令、消息回复/编辑、通知和附件资源下载。
- 使用 tenant/chat/root message 建立稳定限定会话标识；平台与实例数据/锁隔离已接入组合根。
- 接入 SDK safety queue、陈旧消息窗口、发送重试、生命周期重连/自愈及独立于自愈开关的 SIGTERM/SIGINT 优雅断开。
- 支持原生交互卡片、button、select、卡片原位更新和任务状态 reaction；SDK 与 CLI transport 都能消费 `card.action.trigger`。
- 支持将共享 modal view 映射为 Card 2.0 表单，并把 SDK/CLI 的表单提交规范化到共享 modal handlers。
- 支持事件型机器人自定义菜单，将 `application.bot.menu_v6` 的 `event_key` 路由到共享 command router。
- 支持飞书原生 app slash command：按 provider 前缀渲染共享 command spec，`/command args` 通过普通消息事件复用文本命令核心；readiness 只读核对注册表，独立同步命令默认检查、显式 `--apply` 才创建或更新且不删除额外命令。
- 当前绑定应用的 46 条原生 slash commands 已按 dry-run 后显式 additive apply 并只读复核为 46/46 matched；provisioning scopes 2/2，missing/outdated/extra 均为 0，剩余容量 54/100。
- 支持 SDK/CLI/Webhook 连接健康、生命周期重试/自愈和消息投递指标，并在共享 `status` 报告中展示。
- 支持群聊 reply-chain 子会话，将 Codex/Claude fork 和 Codex side 的创建、rename、失败补偿、消息回放及关闭归档映射为根消息操作；私聊明确不支持创建子会话。
- 支持可选 Webhook transport：verification token、签名验证、encrypted payload 解密、URL challenge、固定 path、POST-only、body limit 和慢连接 HTTP 超时边界。
- 支持消息、卡片 action 和机器人菜单的有界事件去重，统一 SDK safety pipeline 与 CLI/Webhook 入口的重投语义。
- 支持群聊非表单 `ephemeral` 响应的私聊等价实现；私聊卡片保留原 chat/reply-chain session 上下文并在重启后恢复，权限拒绝不会覆盖共享卡片。已有私聊卡的非表单响应原位更新；Card 2.0 成功提交按“原卡确认 + 新 Settings 卡”完成。
- 支持复用生产配置解析的 Lark 部署预检，检查 transport、凭证占位符、domain、Webhook endpoint、数值边界、本地依赖和 allowlist，并可只读验证凭证、bot identity 与版本化 tenant-scope 基线。
- `docs/lark-app-config.v1.json` 固化消息、资源、卡片回调、reaction 权限及 WebSocket/Webhook 基线，`docs/lark-deployment-checklist.md` 固化真实凭证和 Webhook 部署 smoke 步骤。
- 增加 Lark Foundation/Adapter conformance、输入、投递、安全、reply-chain fork/side、Webhook 和 Node.js 18 SDK smoke 测试。

验收进度：

- 当前应用的 credential-verified readiness 已通过：tenant scopes 9/9、事件 2/2、卡片回调 1/1、机器人菜单 7/7、原生 slash commands 46/46，且已配置当前应用作用域内的单用户 allowlist。
- 隔离私聊已验证主动消息、`!status` 收发、`!settings` 卡片及原位更新、select/Card 2.0 回调、机器人菜单事件、`/cx_status` 关联回复、普通 prompt、带参数原生命令和未知 slash-path 回退；不存在的 Codex profile 也正确进入表单校验错误路径。
- 隔离群聊已验证 @/未 @、真实图片、长任务取消/reaction、fork/side reply chain 和 side 根卡片关闭标记；Settings 成功保存和私密响应跨重启也已完成。受控本机代理 smoke 已验证真实断网后同一主进程 reconnect/reconnected、3/3 consumers 恢复，以及 `!status` 的重试和消息投递指标。真实第二用户拒绝已通过 `smoke:lark-denial-live` 的 prepare/observe/verify 闭环：生产 card consumer 收到不同于 owner 的操作者回调，拒绝私聊发送成功且与群聊分离，共享卡片哈希保持不变；驱动支持精确 `--group-name` 选择和发送后服务端卡片哈希基线。真实公网 Webhook 现也已有 `smoke:lark-webhook-live`：强制生产 Webhook/encrypt key/公网健康条件，只记录真实已验证请求、成功处理的消息/slash/菜单/卡片事件和应用/代理恢复布尔证据；当前生产仍为 CLI transport 且缺少 Webhook secrets/callback，因此只读 preflight 在网络访问和状态写入前拒绝。CLI transport 的空闲实例与受控运行中任务退出已在 `SELF_HEAL_ENABLED=false` 下完成真实 SIGTERM 验收，包含忽略 SIGTERM 子进程的有界 SIGKILL 收敛。完成公网 Webhook 真实闭环后，阶段 6 才从“验收中”更新为“已完成”。

### 阶段 7：迁移与统一运维（进行中）

- 已增加 `BOT_PLATFORM=discord|lark` 与 `BOT_INSTANCE_ID`；Slack 在 Adapter 实现时再加入枚举。
- 已支持同一代码库启动不同平台/实例，并保持 session、进程锁、workspace lock、project-upgrade 状态和日志标识隔离。
- 待提供旧 Discord key 到新限定 key 的 dry-run、备份、迁移和回滚工具；在工具和回滚验证完成前保持 Discord 裸 channel ID，不进行静默迁移。
- 平台中立健康读取和 Lark 连接/投递指标已完成；Discord 及未来 Adapter 的连接、速率限制和投递指标继续按同一快照形状补齐。

## 后续开发计划

### P0：完成飞书生产验收并发布

- 补齐公网 Webhook 所需的 App Secret、verification token、encrypt key 和开放平台 callback 配置，在 TLS 反向代理后运行 `smoke:lark-webhook-live` prepare/observe/verify，完成真实 challenge/签名/加密事件、机器人菜单、slash command、卡片 action 与应用/代理重启恢复 smoke。
- 完成剩余 smoke 后重新运行 credential-verified readiness、`test:lark`、`test:progress`、语法/格式/原子提交检查，并记录应用版本、region、transport、时间和非敏感结果。
- 对 smoke 发现的问题只做飞书 Adapter、transport 或平台契约内的修复；若需要修改共享核心，先补跨 Discord/Lark 的边界与回归测试。
- 复核 README、环境变量示例、权限/事件基线和运维清单与实际发布应用一致，随后准备版本号、发布说明和可回滚部署步骤。

完成标准：自动化回归通过，readiness 无 error/warning，17 项真实凭证 smoke 全部完成或有明确不适用说明，且单消费者部署、限制性 allowlist、优雅退出和恢复路径均有记录。

### P1：统一运维与可观测性

- 为 Discord 补齐与 Lark 同形的连接、重试、速率限制和消息投递健康快照，保持未配置指标时的兼容输出。
- 增加平台/实例维度的结构化日志字段和运维排障说明，但不记录消息正文、token、App Secret、签名或解密事件体。
- 评估持久化事件去重或外部共享去重存储；在多副本消费前明确单消费者约束与故障切换流程。

### P2：会话键迁移工具

- 设计 Discord 裸 channel ID 到限定 key 的只读扫描和冲突报告。
- 实现 dry-run、备份、显式执行、校验与回滚；覆盖 session、workspace binding、锁和 project-upgrade 状态边界。
- 只有在真实数据副本演练通过后才考虑启用，默认继续保持 Discord 零迁移。

### P3：Slack Adapter

- 在飞书阶段完成生产验收后再选择 Slack SDK 与 Node.js 基线，优先评估 Socket Mode、ack 时限、Block Kit/modal、速率限制和事件重投。
- 复用现有 Foundation、conformance suite、限定会话键和健康快照，不复制 session、queue、runner、settings、workspace 或 fork/side 核心逻辑。
- 先交付消息/命令 MVP，再依次补齐原生交互、子会话语义、运维预检和真实凭证 smoke。

## 配置规划

配置按平台命名空间隔离；SDK 敏感凭证从环境变量或外部 secret store 读取，CLI 模式则复用 `lark-cli` 的加密本机凭证。当前与规划变量如下，其中 Slack 变量尚未启用：

```text
BOT_PLATFORM=discord|lark
BOT_INSTANCE_ID=default

SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_SIGNING_SECRET=       # 仅 HTTP 回调模式需要

LARK_APP_ID=
LARK_APP_SECRET=
LARK_DOMAIN=feishu|lark
LARK_TRANSPORT=auto|sdk|cli|webhook
LARK_CLI_BIN=lark-cli
LARK_CLI_PROFILE=
LARK_WEBHOOK_VERIFICATION_TOKEN=
LARK_WEBHOOK_ENCRYPT_KEY=
LARK_WEBHOOK_HOST=127.0.0.1
LARK_WEBHOOK_PORT=3000
LARK_WEBHOOK_PATH=/lark/events
LARK_WEBHOOK_HEALTH_PATH=/healthz
LARK_WEBHOOK_PUBLIC_URL=https://bot.example.com/lark/events
LARK_WEBHOOK_MAX_BODY_BYTES=1048576
LARK_WEBHOOK_HEADERS_TIMEOUT_MS=10000
LARK_WEBHOOK_REQUEST_TIMEOUT_MS=15000
LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS=5000
LARK_EVENT_DEDUP_WINDOW_MS=43200000
LARK_EVENT_DEDUP_MAX_ENTRIES=5000
LARK_ALLOWED_CHAT_IDS=
LARK_ALLOWED_TENANT_IDS=
LARK_ALLOWED_USER_IDS=
LARK_MENTION_ONLY_CHAT_IDS=
```

allowlist 也应使用平台限定配置，避免相同裸 ID 在不同平台间误匹配。多实例部署时，session 数据文件、single-instance lock、workspace lock 命名空间和日志实例标识必须同时按平台与实例名隔离。

## 测试策略

- 契约测试：Adapter 必填字段、capability 类型和无效实现拒绝。
- 映射测试：会话键编码、解析、可选字段和非法输入。
- Adapter 单测：工厂调用顺序、依赖透传和强制交叉绑定。
- Discord 回归：原有 entry handler、lifecycle、reply、command 和 app context 测试。
- 后续平台契约套件：同一组消息、命令、取消、附件和错误场景分别运行在每个 Adapter fixture 上。
- 少量真实平台 smoke test：连接、接收消息、回复、取消和重连；凭证不进入仓库。

## 风险与约束

- prompt 主流程、command UI、interaction response、command registry、interaction 输入、运行时 capability、session topology 和 fork/side conversation lifecycle 已建立平台边界；Discord 与 Lark 分别维护自己的身份、权限、事件、投递和生命周期逻辑。Slack 仍需独立设计，不能直接复用现有 SDK 假设。
- Slack 的 `ack` 时限、消息更新频控与 Discord 不同；飞书/Lark 的卡片、用户 ID 类型和权限模型也不同，不能用字段重命名代替适配。
- 跨平台线程语义不同，需要以 conversation/thread 映射策略为准，不能强制所有平台模拟 Discord thread。
- Lark 官方 SDK 当前在 Node.js 18 上可用；Slack Bolt 5 系列至少要求 Node.js 20，因此 Slack 阶段可能推动 Node.js 22 LTS 升级，但该升级与 Lark 解耦。

## 当前明确不做

- 不添加 Slack SDK、配置或业务入口。
- Discord 弹窗 modal 在 Lark 由 Card 2.0 表单等价实现；群聊支持 reply-chain 子会话，私聊不模拟不存在的子会话能力。
- 不重命名项目，不批量移动现有 Discord 文件。
- 不修改 Discord session key 或已有持久化数据。
- 不为平台抽象重写 provider runner、session、queue 或 workspace lock 核心语义。
