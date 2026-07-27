# Agents in Discord

在 Discord 频道/线程或飞书/Lark 聊天里运行 Codex CLI、Claude Code、Antigravity CLI、ZCode CLI、Pi Agent 和 Oh My Pi；另提供独立的微信 Codex 入口。

它是一个独立 bridge，不是 OpenClaw 插件，也不需要 OpenClaw。

[English](./README.en.md)

维护者：[ATou](https://github.com/atou42) 与 [Lark](https://github.com/Larkspur-Wang)

ZCode CLI 支持从 [v0.13.0](https://github.com/atou42/agents-in-discord/releases/tag/v0.13.0) 开始提供。

## 核心模型

一个平台会话（Discord 频道/线程，或飞书/Lark chat/reply chain）对应一条 provider 会话。

你可以在同一个 Discord 服务器里使用共享 bot，也可以把 Codex、Claude、Antigravity、ZCode、Pi、OMP 拆成独立 bot。每个 provider 有自己的 session、workspace、模型和运行配置，不会混在一起。Pi 和 OMP 共用兼容层，但会分别读取 `~/.pi` 和 `~/.omp`，恢复参数和权限参数也按各自 CLI 处理。ZCode 使用 headless JSON runner。Antigravity 的模型菜单会合并当前设置、官方 reasoning model 列表和本机日志里出现过的模型。

Discord 继续提供完整 slash command 和交互面板；飞书/Lark 采用消息优先接入，同时支持已注册的 provider 前缀原生 slash command、文本命令、原生卡片按钮/下拉和 Card 2.0 表单。

长任务不会一直刷屏。bot 会更新进度卡，也可以按频道设置成持续发送过程消息。最终回复是否 @ 发起人，也可以在设置里选。

Codex 的安全模式现在使用 workspace-write 沙盒，并把需要审批的动作交给 Codex 的 auto review reviewer。危险模式仍然是完全绕过 sandbox 和 approval，只适合受控的个人环境。

## 你能做什么

- 在 Discord 或飞书/Lark 里发任务，让 CLI agent 在指定 workspace 里工作
- 按频道保存会话，下次继续同一条上下文
- 在 Discord 用设置面板切换 provider、model、effort、fast、compact、reply、workspace；Lark 可使用对应原生卡片控件和文本命令
- 查看实时进度、队列、运行状态、quota、账号和当前配置来源
- 对同一个 workspace 做串行保护，避免多个频道同时改同一份代码
- 通过 Discord `/cancel` 或平台文本命令中断当前任务并清空队列
- 在长任务里选择只看进度卡，或让过程消息持续流出

## 准备

需要 Node.js 18+、你要使用的 CLI，以及 Discord Bot Token 或飞书/Lark 鉴权配置。Lark 本机模式可复用 `lark-cli` 的加密持久登录，SDK/Webhook 模式使用应用凭证；接入已在 Node.js `v18.17.1` 验证，不要求先升级到 Node.js 22。

本项目不管理各个 CLI 自己的登录状态。请先在本机 CLI 里完成登录，并确认命令能直接运行。

```bash
codex --version
claude --version
agy --version
zcode --version
pi --version
omp --version
```

如果 CLI 不在 bot 进程的 PATH 里，可以在 `.env` 里写绝对路径。

```env
CODEX_BIN=/opt/homebrew/bin/codex
CLAUDE_BIN=/opt/homebrew/bin/claude
ANTIGRAVITY_BIN=/opt/homebrew/bin/agy
ZCODE_BIN=/Users/you/.local/bin/zcode
PI_BIN=/Users/you/.local/bin/pi
OMP_BIN=/Users/you/.local/bin/omp
```

## 安装

```bash
git clone https://github.com/atou42/agents-in-discord.git
cd agents-in-discord
cp .env.example .env
npm install
npm run setup-hooks
npm start
```

`npm run setup-hooks` 只需要在 clone 后执行一次。它会启用本仓库的提交前检查。

默认 `npm start` 启动 Discord。飞书/Lark 使用下面单独的平台入口。

## Discord 里怎么用

默认 shared bot 的 slash 前缀是 `cx_`。独立 Claude、Antigravity、ZCode、Pi 和 OMP bot 默认使用 `cc_`、`ag_`、`zc_`、`pi_` 和 `omp_`。

最常用的入口是这些。

```text
/cx_onboarding     首次引导，设置语言、provider、workspace
/cx_settings       打开交互式设置面板
/cx_status         查看当前配置、运行状态、quota、账号信息
/cx_progress       查看当前任务进度
/cx_queue          查看当前频道队列
/cx_cancel         中断当前任务并清空队列
/cx_new            开一个新会话，但保留频道配置
/cx_resume         绑定已有 provider 会话
/cx_sessions       查看最近会话
/cx_setdir         设置当前频道 workspace
/cx_compact        配置 compact 策略和阈值
/cx_goal          查看或设置当前 Codex session 的持久目标
```

文本命令主要作为兜底。常用的是 `!cancel`、`!c`、`!progress`、`!status`、`!resume`、`!sessions`、`!goal status`。

`/cx_goal action:set objective:<目标>` 或 `!goal <目标>` 会把当前 Codex session 的目标设为 active，并在 runner 空闲时继续执行。目标需要带图片或文件时，用普通消息 `!goal <目标>` 发送，附件会一起进入 goal 上下文。`/cx_status` 和 `!status` 会显示当前 goal；只查 goal 可以用 `/cx_goal action:status` 或 `!goal status`。`pause` 会停止续跑，`resume` 会恢复续跑，`clear` 会清除 goal。

## 飞书/Lark 接入

当前 Lark 接入支持两种 WebSocket 长连接和一种 HTTP Webhook 回调，可直接运行在 Node.js 18：

- `LARK_TRANSPORT=cli`：复用官方 `lark-cli` 持久化的加密凭证，适合本机使用，不需要把 App Secret 复制到项目 `.env`。
- `LARK_TRANSPORT=sdk`：直接使用官方 `@larksuiteoapi/node-sdk` 和环境变量凭证，适合服务器或外部 secret store。
- `LARK_TRANSPORT=webhook`：使用官方 SDK dispatcher 接收 HTTPS 回调，校验 verification token；配置 encrypt key 后同时验证签名并解密加密事件，适合已有公网回调入口的部署。

`LARK_TRANSPORT=auto` 是默认值：配置了 `LARK_APP_ID` 和 `LARK_APP_SECRET` 时使用 SDK WebSocket，否则自动使用 CLI；Webhook 必须显式选择。CLI 模式一次性设置：

```bash
npm install -g @larksuite/cli
lark-cli config init --new
lark-cli auth login --recommend
lark-cli auth status --verify --json
```

启动前建议先运行只读预检。默认命令只检查有效配置和本地 SDK/CLI；增加 `--verify-credentials` 后，CLI 模式会验证所选 profile，SDK/Webhook 模式会获取 tenant token 并读取 bot info。两种检查都不会启动事件消费者、监听 Webhook 或发送消息，输出也不会显示凭证值：

```bash
npm run check:lark
npm run check:lark -- --verify-credentials
npm run sync:lark-commands
npm run sync:lark-commands -- --dry-run
# 确认只读差异后才执行：npm run sync:lark-commands -- --apply
```

然后启动：

```bash
npm run start:lark
```

若使用 SDK WebSocket 或 Webhook 模式，先在开放平台启用机器人能力、订阅事件 `im.message.receive_v1`（使用机器人菜单时再订阅 `application.bot.menu_v6`）和回调 `card.action.trigger`，并授予收取消息、以机器人身份发送/更新/撤回消息、读取消息资源及读写 reaction 所需权限，然后配置：

版本化的精确权限/事件基线与真实凭证 smoke 步骤见 [`docs/lark-deployment-checklist.md`](docs/lark-deployment-checklist.md)。`check:lark -- --verify-credentials` 还会只读检查已发布机器人版本、WebSocket/Webhook 接入方式、发布事件、机器人菜单的必需 `event_key` 和原生 slash command 注册表，并要求 chat/tenant/user allowlist 至少配置一项；空 allowlist 不会跳过其他远端检查，但最终 readiness 不会通过。菜单仅启用但命令键缺失、或必需的原生命令注册表无法读取时也不会误判通过。若开放平台接口没有返回卡片 callback 列表，会明确输出人工核对项，而不会启动消费者或发送消息。`sync:lark-commands` 默认只检查差异及 slash command read/write provisioning scopes；`--dry-run` 会逐条验证整批 create/update 请求但不写入。显式传入 `--apply` 后会先完成同样的整批预演，全部通过才分别创建缺失命令、更新过期描述，并且不会删除额外命令。缺少 read scope 时不会伪装成空注册表，缺少 write scope 时有待处理的预演/apply 会在执行操作前失败。写入前还会检查飞书每个应用 100 条命令的容量上限，空间不足时不会进行部分同步。

```env
LARK_TRANSPORT=sdk
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=...
LARK_DOMAIN=feishu
LARK_ALLOWED_CHAT_IDS=
LARK_ALLOWED_TENANT_IDS=
LARK_ALLOWED_USER_IDS=
LARK_MENTION_ONLY_CHAT_IDS=
```

若使用 Webhook，开放平台的事件订阅和卡片回调都应指向同一个公网 HTTPS 地址；进程默认只监听 loopback，由反向代理终止 TLS：

```env
LARK_TRANSPORT=webhook
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=...
LARK_WEBHOOK_VERIFICATION_TOKEN=...
LARK_WEBHOOK_ENCRYPT_KEY=...
LARK_WEBHOOK_HOST=127.0.0.1
LARK_WEBHOOK_PORT=3000
LARK_WEBHOOK_PATH=/lark/events
LARK_WEBHOOK_HEALTH_PATH=/healthz
LARK_WEBHOOK_MAX_BODY_BYTES=1048576
LARK_WEBHOOK_HEADERS_TIMEOUT_MS=10000
LARK_WEBHOOK_REQUEST_TIMEOUT_MS=15000
LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS=5000
```

反向代理必须原样转发请求体和 `x-lark-*` 请求头。listener 会分别限制请求头接收、完整请求接收和 keep-alive 空闲时间，避免慢连接长期占用 socket；请求头超时不能大于完整请求超时。公网 TLS、challenge、错误签名、body limit 和超时的部署检查见上面的 checklist。

CLI 有多个应用配置时可用 `LARK_CLI_PROFILE` 选择 profile；`LARK_CLI_BIN` 可覆盖命令路径。中国大陆飞书使用 `LARK_DOMAIN=feishu`，国际版 Lark 使用 `LARK_DOMAIN=lark`（这两个变量影响 SDK WebSocket 和 Webhook，CLI 模式跟随 profile 的 brand）。

当前支持群聊 @、私聊、普通消息、文本命令（例如 `!status`、`!progress`、`!cancel`）、附件元数据、Codex 原生图片下载、进度消息编辑、任务状态 reaction、事件去重和 transport 自愈。消息、卡片 action 和机器人菜单按稳定事件 ID 在有界时间窗内去重，避免 Webhook/CLI 重投导致任务执行两次；窗口和内存上限可用 `LARK_EVENT_DEDUP_WINDOW_MS`、`LARK_EVENT_DEDUP_MAX_ENTRIES` 调整。Webhook 模式还提供与回调 POST 路径分离的只读 GET 健康探针。收到 `SIGTERM`/`SIGINT` 时会停止当前任务并断开 SDK、CLI 或 Webhook channel；这个优雅退出路径不依赖 `SELF_HEAL_ENABLED`，退出期间也不会触发自愈重启。`!status` 会显示当前 transport 的连接状态、重试/自愈次数以及消息投递成功、失败、进行中和最近失败。Settings、Onboarding、Workspace Browser、workspace 冲突处理及重试入口可使用飞书原生卡片按钮/下拉选择；模型、Codex profile 和 compact 阈值等共享 modal 会映射为 Card 2.0 内嵌表单。打开表单与校验失败仍原位保留 Card 2.0；保存成功后旧表单原位显示提交确认，并另发一张新的 Card 1.0 Settings 卡承载最新控件，避免飞书不支持的原位 schema 降级。回复链按 `root_id` 隔离会话；平台和实例状态通过 `BOT_PLATFORM`、`BOT_INSTANCE_ID` 隔离。

SDK、CLI 和 Webhook 模式都支持卡片 action；CLI 会消费 `im.message.receive_v1`、`card.action.trigger` 和 `application.bot.menu_v6`，Webhook 则通过同一个验证后的 HTTP 入口分发。飞书没有复用 Discord 弹窗 modal，而是用 Card 2.0 表单提供等价输入能力。群聊卡片产生的非表单 `ephemeral` 响应会改为发送到操作者与 bot 的私聊，不会覆盖所有人可见的共享卡片；私聊卡片会携带原群聊或 reply-chain 的限定会话上下文，因此后续按钮、下拉和表单即使跨进程重启仍操作原会话。来自现有私聊卡的非表单私密响应会原位更新该私聊卡，过期控件也会被替换为无操作项的提示卡；群聊不会产生旁路回复。Card 2.0 表单在当前卡片原位打开并保留校验/修正流程，成功提交则原位确认并发送新的 Settings 卡。还可在开放平台配置“事件”型机器人自定义菜单，`event_key` 使用共享命令名（例如 `status`、`settings`、`progress`、`queue`、`cancel`、`new`、`onboarding`）；点击后结果会发送到操作者与 bot 的私聊并原位更新。原生 slash command 使用与 Discord 相同的 provider 前缀规则，默认示例为 `/cx_status`、`/cc_status`、`/ag_status`、`/zc_status`、`/pi_status` 或 `/omp_status`，并通过普通消息事件复用文本命令核心及参数解析。群聊中的 `fork` 和 Codex `side` 会创建新的根消息，并把后续内容隔离到独立 reply chain；关闭 side 会在根消息上写入关闭标记。私聊不能创建这种子会话。若未注册命令或未启用相应事件/回调，相关原生入口不会生效。

## 微信入口（可选）

微信入口是独立进程，不修改 Discord bot 的启动路径、token、频道 session 或交互组件。两边复用同一套 Codex runner，并共享 workspace 文件锁，所以同一个项目正在 Discord 中执行时，微信任务会等待而不是并发修改。

先在 `.env` 配置允许的 workspace。扫码登录所使用的微信账号默认加入白名单，也可以显式增加 iLink user ID。

```env
WECHAT_WORKSPACE_ROOTS=~/GitHub,~/Lark_Project
WECHAT_DEFAULT_WORKSPACE_DIR=~/GitHub
WECHAT_ALLOWED_USER_IDS=
WECHAT_CODEX_RUNTIME_MODE=long
WECHAT_ALLOW_DANGEROUS=false
```

启动微信入口：

```bash
npm run start:wechat
```

首次启动会在终端显示二维码。微信入口当前支持文本和语音转写，不接收图片或文件。常用命令：

```text
/sessions                 浏览本机 Codex 历史会话
/resume 2                 绑定列表中的第 2 条会话
/resume <thread-id>       绑定指定 Codex thread
/session                  查看当前绑定
/new                      下一条消息新建会话
/status                   查看 workspace、model、effort 和运行状态
/cancel                   取消当前任务
/dir <路径>               切换 workspace，同时解除旧 session
```

微信 session 映射和 iLink 凭据分别保存在 `data/wechat/`，不会写入 Discord 的 `data/sessions*.json`。真实 Codex 会话仍来自同一个 `~/.codex/sessions`。

iLink 登录和消息协议实现参考了 MIT 项目 [sgaofen/cli-in-wechat](https://github.com/sgaofen/cli-in-wechat)，但没有采用它的 CLI adapter 或 `resume --last` 会话模型。

### macOS 长期运行 Discord 和微信

两个入口使用独立的 `launchd` 服务，登录后自动启动，异常退出后自动拉起：

```bash
# 1. 先配置 .env，至少填写 CODEX__DISCORD_TOKEN
cp .env.example .env

# 2. 微信首次前台扫码，看到 Agents in WeChat started 后按 Ctrl-C
npm run start:wechat

# 3. 安装并启动两个后台服务
npm run services:install
```

常用维护命令：

```bash
npm run services:status
npm run services:logs
npm run services:restart
npm run services:stop
npm run services:start
npm run services:uninstall
```

只操作一个入口时，直接调用管理脚本并传 `discord` 或 `wechat`：

```bash
bash scripts/manage-channel-services-macos.sh restart wechat
bash scripts/manage-channel-services-macos.sh logs discord
```

Discord 日志写入 `logs/discord.service*.log`，微信日志写入 `logs/wechat.service*.log`。微信凭据保存在本机忽略提交的 `data/wechat/credentials.json`；如果凭据过期，先停止微信服务，再前台运行 `npm run start:wechat` 重新扫码。

## 设置面板

推荐优先用 `/cx_settings`。它比记命令更稳，也会显示当前值来自哪里。

设置有继承关系。线程里的显式设置优先，其次是父频道默认，再其次是 provider 或环境默认。`/cx_status` 会显示当前实际生效值和来源。

Codex 默认设置会直接修改 `~/.codex/config.toml`。频道或线程里的覆盖仍然优先，只有在跟随默认时才会吃到这里。

## Workspace

workspace 是 CLI 真正执行任务的目录。

推荐给每个 provider 设置一个默认 workspace。线程可以继续继承默认，也可以单独覆盖。子线程默认继承父频道 workspace，也可以配置成独立 workspace。

同一个 workspace 同一时间只允许一个任务执行。其他任务会排队或提示 workspace 正忙，避免并发改同一份代码。

## 运行模式

本地开发可以直接跑 shared bot。

```bash
npm start
```

如果想把 provider 拆成独立 bot，可以在同一个 `.env` 里写分组配置，然后分别启动。

```bash
npm run start:codex
npm run start:claude
npm run start:antigravity
npm run start:zcode
npm run start:pi
npm run start:omp
```

分组配置还支持 `PI__*` 和 `OMP__*`。通常只需要各自的 `DISCORD_TOKEN`，再按需填默认模型、默认 workspace 和 CLI 路径。

Lark 当前也可以和 `BOT_PROVIDER=codex|claude|antigravity|zcode|pi|omp` 组合使用；例如 `CODEX__LARK_TRANSPORT`、`CODEX__LARK_CLI_PROFILE` 或 `CODEX__LARK_APP_ID` / `CODEX__LARK_APP_SECRET` 会覆盖共享 Lark 配置，其他 provider 同理。

## 关键配置

完整配置看 `.env.example`。README 只列最常改的项。

```env
DISCORD_TOKEN=...
ALLOWED_CHANNEL_IDS=...
ALLOWED_USER_IDS=...
WORKSPACE_ROOT=/Users/you/workspaces
DEFAULT_WORKSPACE_DIR=/Users/you/project
DEFAULT_MODE=safe
DEFAULT_UI_LANGUAGE=zh
```

常见 provider 分组配置如下。

```env
CODEX__DISCORD_TOKEN=...
CODEX__DEFAULT_WORKSPACE_DIR=/Users/you/codex-work
CODEX__SLASH_PREFIX=cx

CLAUDE__DISCORD_TOKEN=...
CLAUDE__DEFAULT_WORKSPACE_DIR=/Users/you/claude-work
CLAUDE__SLASH_PREFIX=cc

ANTIGRAVITY__DISCORD_TOKEN=...
ANTIGRAVITY__DEFAULT_WORKSPACE_DIR=/Users/you/antigravity-work
ANTIGRAVITY__SLASH_PREFIX=ag

ZCODE__DISCORD_TOKEN=...
ZCODE__DEFAULT_WORKSPACE_DIR=/Users/you/zcode-work
ZCODE__SLASH_PREFIX=zc
ZCODE_BIN=/Users/you/.local/bin/zcode

PI__DISCORD_TOKEN=...
PI__DEFAULT_WORKSPACE_DIR=/Users/you/pi-work
PI__SLASH_PREFIX=pi
PI_BIN=/Users/you/.local/bin/pi

OMP__DISCORD_TOKEN=...
OMP__DEFAULT_WORKSPACE_DIR=/Users/you/omp-work
OMP__SLASH_PREFIX=omp
OMP_BIN=/Users/you/.local/bin/omp
```

访问控制建议至少设置 `ALLOWED_CHANNEL_IDS` 或 `ALLOWED_USER_IDS`。多人服务器里不要默认使用 dangerous mode。

Lark 使用 `LARK_ALLOWED_CHAT_IDS`、`LARK_ALLOWED_TENANT_IDS`、`LARK_ALLOWED_USER_IDS` 和 `LARK_MENTION_ONLY_CHAT_IDS`；未配置 Lark 专用值时会回退到对应的共享 allowlist。

compact 相关配置可以在 `.env` 里设默认，也可以在 Discord 里按频道覆盖。

```env
COMPACT_STRATEGY=native
COMPACT_ON_THRESHOLD=true
MAX_INPUT_TOKENS_BEFORE_COMPACT=272000
```

进度卡默认只展示 agent 自己的过程叙述，不展示模型的 reasoning 摘要。想开的话设 `SHOW_REASONING=true`，同时 CLI 那边也要产出 reasoning 事件——Codex 需要在 `~/.codex/config.toml` 里设 `model_reasoning_summary = "detailed"`。

注意 codex-cli 0.144.0 下 `gpt-5.6` 系列（sol/terra/luna）不产出 reasoning 事件，因为它们在 `~/.codex/models_cache.json` 里缺少 CLI 要求的 `supports_reasoning_summaries` 字段；`gpt-5.4` 可以正常产出。另外 reasoning 是摘要而非完整思维链，内容通常比过程叙述短。

```env
SHOW_REASONING=false
```

## 代理

如果 Discord 或 CLI 需要走代理，可以设置：

```env
HTTP_PROXY=http://127.0.0.1:7890
SOCKS_PROXY=socks5h://127.0.0.1:7891
```

`npm install` 会自动运行 `npm run patch-ws`，让 Discord Gateway WebSocket 可以使用自定义 agent。

代理键的大小写补齐与本地 SOCKS 推断只作用于当前进程，不会自动写回 `.env`。通过 systemd 或 shell 临时注入代理做断网 smoke 后，清除外部环境并重启服务即可恢复直连，不会把临时代理固化到项目配置。

## 本地服务

macOS 上推荐用仓库自带脚本重启 bot 服务。

```bash
scripts/restart-discord-bot-service.sh codex
scripts/restart-discord-bot-service.sh claude
scripts/restart-discord-bot-service.sh antigravity
scripts/restart-discord-bot-service.sh zcode
scripts/restart-discord-bot-service.sh pi
scripts/restart-discord-bot-service.sh omp
scripts/restart-discord-bot-service.sh all
```

这个脚本会使用受保护的 launchd label，避免误用危险的 `launchctl` 操作。

## 项目升级

Bot 会检查 `agents-in-discord` 自己是否落后远端，默认只提示，不会自动改文件。可以在 Discord 里用 `/cx_upgrade action:status` 或 `!upgrade status` 查看本地版本、远端版本、落后提交数和更新说明。

手动升级：

```bash
npm run upgrade:project -- status
npm run upgrade:project -- apply
```

Discord 里也可以用 `/cx_upgrade action:apply` 或 `!upgrade apply`。升级只会在工作区干净、当前分支能 fast-forward 到远端时执行；本地有改动、分支分叉、远端不可达都会停止。执行前会先在临时 worktree 里安装依赖并跑验证，验证通过后才修改主工作区。

升级模式：

```bash
npm run upgrade:project -- notify
npm run upgrade:project -- auto
npm run upgrade:project -- off
```

`notify` 是默认值，只提示。`auto` 会在检测到安全升级且所有活跃 bot 进程都空闲时自动执行验证并请求重启。项目升级默认重启 `all`，因为多个 provider bot 通常共用同一个仓库。Discord 里的 `apply` 和 `mode` 需要 `AGENTS_IN_DISCORD_UPGRADE_ADMIN_USER_IDS`，未配置时只能查状态。常用环境变量：

```bash
AGENTS_IN_DISCORD_UPGRADE_MODE=notify
AGENTS_IN_DISCORD_UPGRADE_ADMIN_USER_IDS=123,456
AGENTS_IN_DISCORD_UPGRADE_NOTIFY_CHANNEL_IDS=123,456
AGENTS_IN_DISCORD_UPGRADE_CHECK_INTERVAL_MS=21600000
AGENTS_IN_DISCORD_UPGRADE_STATUS_CACHE_MS=600000
AGENTS_IN_DISCORD_UPGRADE_VERIFY_COMMAND="npm run test:progress"
AGENTS_IN_DISCORD_UPGRADE_RESTART_TARGET=all
```

## Codex CLI 自动升级

仓库内置一个可选的 Codex CLI 升级器。它可以定时检查 Codex 更新，升级成功后重启 bot 服务。

```bash
npm run install:auto-upgrade
npm run run:auto-upgrade
```

只想 dry-run：

```bash
CODEX_UPGRADE_DRY_RUN=1 npm run run:auto-upgrade
```

## 发布

[v0.13.0](https://github.com/atou42/agents-in-discord/releases/tag/v0.13.0) 是首个支持 ZCode CLI 的版本。

常规改动先跑测试。

```bash
npm run test:progress
```

切版本使用项目脚本。

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

## 故障排查

如果 `/cx_status` 显示 CLI 不存在，先在同一个机器上确认路径。

```bash
which codex
which claude
which agy
which zcode
which pi
which omp
```

然后把绝对路径写进 `.env`，重启 bot。

如果 settings 里看到某个值和预期不同，先看 `/cx_status`。status 会显示当前生效值，也会显示它来自当前线程、父频道、全局配置还是环境默认。

如果任务一直不开始，先看 `/cx_queue` 和 `/cx_progress`。同一个 workspace 正在被其他频道使用时，任务会等待锁释放。

## 本地主动发消息

可以用 bot token 从本机向指定频道发消息。

```bash
npm run send:channel -- --channel 1487823042121040036 --content "部署完成"
cat notice.md | npm run send:channel -- --channel 1487823042121040036 --stdin
```
