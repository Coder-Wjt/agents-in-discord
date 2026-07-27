# 飞书/Lark 部署检查清单

当前版本化应用配置基线见 [`lark-app-config.v1.json`](./lark-app-config.v1.json)。它不是开放平台可直接导入的 manifest，而是本项目用于审查权限漂移的机器可读清单。

## 开放平台配置

1. 启用机器人能力。
2. 选择事件接入方式：`sdk` / `cli` 使用 WebSocket 长连接；`webhook` 使用请求地址回调。不要让同一个应用实例同时由两套进程消费同一批事件。
3. 订阅事件 `im.message.receive_v1`；使用原生机器人菜单时同时订阅 `application.bot.menu_v6`。
4. 启用卡片回调 `card.action.trigger`。Webhook 模式下，事件订阅和卡片回调可以指向同一个公网 HTTPS URL，例如 `https://bot.example.com/lark/events`。
5. 配置“事件”型机器人自定义菜单；版本化基线要求发布 `status`、`settings`、`progress`、`queue`、`cancel`、`new`、`onboarding` 这 7 个 `event_key`。可自由选择菜单层级、显示名称并添加其他菜单项，但必需命令键缺失时 readiness 不通过。
6. 授予基线列出的 tenant scopes：群聊 @/私聊接收、消息读取、以 bot 身份发送、消息更新/撤回、消息资源读取以及 reaction 读写。`im:message:recall` 用于 fork/side 创建失败时撤回补偿根消息，不能因主流程较少触发而省略。
7. 发布应用版本，并确保机器人已加入用于测试的群聊；私聊和机器人菜单测试需要用户可访问该应用。
8. 原生 slash command 管理使用单独的 provisioning scopes：`application:app_slash_command:read` 与 `application:app_slash_command:write`。它们不属于消息运行时最小权限；使用与目标应用绑定的 `lark-cli` profile 执行 `npm run sync:lark-commands` 只读查看差异和两项权限状态，再执行 `npm run sync:lark-commands -- --dry-run` 逐条验证整批请求。确认后才显式执行 `npm run sync:lark-commands -- --apply`；apply 也会在写入前重复完整预演。缺少 read scope 时工具不会把不可读取误判为空注册表；缺少 write scope 时，只读审计仍可执行，但存在变更的 dry-run/apply 会在操作前失败。同步分别创建缺失项、更新过期描述，不删除开放平台上额外的命令；写入前会按每个应用最多 100 条命令预检容量，容量不足或任一请求预演失败时不执行任何部分写入。

当前绑定应用已获授权执行一次显式 `--apply`，随后完成只读复核：provisioning scopes 2/2、注册表 42/42 matched、missing/outdated/extra 均为 0，剩余容量 58/100。原生 slash commands 已注册，无需再次执行 apply；后续仅在 command spec 发生变化时重新审计并按需同步。

最近一次 credential-verified readiness 已自动通过：tenant scopes 9/9、机器人版本已发布、WebSocket 接入方式正确、必需事件 2/2、卡片回调 1/1、机器人菜单 7/7、原生 slash commands 42/42，并已配置当前应用作用域内的单用户 allowlist。隔离私聊 smoke 已验证主动消息、用户 `!status` 入站和机器人回复闭环、`!settings` 原生卡片及原位更新、select 与 Card 2.0 表单回调、`settings`/`progress` 机器人菜单事件、普通 prompt、带参数原生命令、未知 slash-path prompt 回退，以及 `/cx_status` 原生命令的关联回复；表单提交不存在的 Codex profile `work` 时也按预期进入校验错误路径。隔离群聊已验证未 @ 不回复、@ bot 后关联回复、真实图片下载及原生图片理解、长任务取消与 `THINKING` 到 `No` reaction 更新、fork/side 独立 reply chain，以及 side 关闭后同一原生卡片根消息原位更新为锁定标记。CLI transport 还已在 `SELF_HEAL_ENABLED=false` 下完成空闲实例和受控运行中任务的真实 SIGTERM smoke；真实 consumer-loss smoke 也确认 lifecycle 在主进程不变的情况下完成 self-heal，恢复为 3 个直接消费者、6 个 wrapper/worker 进程且没有重复。其余成功表单保存、私密响应/权限拒绝/跨重启上下文恢复、真实断网重连、`!status` 投递指标核对和公网 Webhook 仍按下方清单继续执行。

### 2026-07-27 验收矩阵

| 验收域 | 状态 | 已有证据 | 后续动作 |
| --- | --- | --- | --- |
| 本地依赖与配置 | 已通过 | CLI transport 可用，生产配置解析、placeholder/数值/path 校验与限制性用户 allowlist 生效 | 发布前复核运行实例使用同一配置来源 |
| 凭证与线上应用 | 已通过 | tenant scopes 9/9、事件 2/2、卡片回调 1/1、菜单键 7/7、原生命令 42/42 | command spec 或应用版本变更后重新运行只读审计 |
| 私聊命令闭环 | 已通过 | 主动消息、`!status`、`!settings`、`/cx_status`、普通 prompt、带参数命令和未知 `/path` prompt 回退已验证 | 应用版本或命令表变化后重跑自动 smoke |
| 原生卡片与表单 | 部分通过 | 卡片发送/原位更新、select、Card 2.0 回调、无效 profile 校验已验证 | 补成功保存、私密响应、权限拒绝和跨重启上下文恢复 |
| 群聊与 reply chain | 部分通过 | 隔离群已验证 @/未 @、fork/side、新根与链内回复；side 关闭后同一交互卡片根原位写入锁定标记 | 补不具备操作权限用户的群聊访问/私密拒绝场景 |
| 附件与任务控制 | 已通过 | 真实图片已下载并作为原生图片输入被精确理解；真实长任务取消后 reaction 从 `THINKING` 更新为 `No` | 应用权限或 transport 变化后重跑 |
| 恢复与指标 | 部分通过 | 自动化覆盖重连、自愈和连接/投递快照；真实 CLI SIGTERM 已验证空闲及运行中任务退出；真实 consumer-loss 已验证主进程内 self-heal、3 个直接消费者恢复且无重复进程 | 完成真实断网恢复和 `!status` 指标核对 |
| Webhook 公网部署 | 待验收 | 本地自动化覆盖 challenge、token、签名、解密、去重、body/timeout/health 边界 | 在 TLS 反向代理后完成真实签名/加密事件和重启恢复 smoke |

“已通过”表示已有自动化或真实平台证据；“部分通过”与“待验收”不能作为生产发布完成标记。每次真实 smoke 只记录非敏感结果，不提交 App ID、版本 ID、chat/user ID、token、签名或消息正文。

CLI 模式复用所选 `lark-cli` profile 对应的同一个应用配置。SDK WebSocket 模式通过 `LARK_APP_ID`、`LARK_APP_SECRET` 和 `LARK_DOMAIN` 连接。Webhook 模式还必须设置 verification token，并建议启用 encrypt key。

## 启动前预检

先运行不会启动 bot 的本地预检：

```bash
npm run check:lark
```

它使用与生产启动相同的配置解析，检查 transport、domain、Webhook callback/health path、port/body limit、去重与投递数值、本地 SDK/CLI 以及 allowlist 是否为空；只报告凭证是否配置，不输出凭证值。配置错误应在启动前修复，不要依赖静默默认值。

需要验证真实凭证时运行：

```bash
npm run check:lark -- --verify-credentials
```

CLI 模式执行所选 profile 的 `auth status --verify --json`；SDK/Webhook 模式获取 tenant token。两条路径都会只读查询 bot info、tenant scopes、应用基础信息、线上版本和 slash command 列表，并对照 `lark-app-config.v1.json` 自动检查：是否存在已发布机器人版本、开放平台接入方式是否与当前 transport 匹配、必需事件是否已发布、机器人菜单是否已启用且包含菜单项，以及 provider 对应的原生命令是否齐全。原生命令注册表若因缺少 `application:app_slash_command:read` 等原因无法读取，会明确失败而不是降级成人工确认。真实凭证模式还要求 `LARK_ALLOWED_CHAT_IDS`、`LARK_ALLOWED_TENANT_IDS` 或 `LARK_ALLOWED_USER_IDS` 至少配置一项；空 allowlist 不会阻止其他只读远端检查继续执行，但会让最终 readiness 失败，避免开放访问状态被误判为可部署。报告只保留布尔值、计数和缺失项，不输出 App ID、版本 ID、command ID、bot/user ID、profile 名称、token 或 URL。

飞书当前应用信息接口可能只返回 callback 接入方式而不返回 `subscribed_callbacks` 列表；遇到这种响应时，预检会把 `card.action.trigger` 明确列入 `manualChecks`，不会伪装成自动验证通过。该命令也不会启动 WebSocket consumer、打开 Webhook listener、读取或发送聊天消息。自动预检通过仍不能替代后面的隔离测试 chat smoke。

## Webhook 部署

推荐让进程保持默认的 `127.0.0.1` 监听，由 Nginx、Caddy、Ingress 或云负载均衡器提供公网 HTTPS。除非容器或网络边界已经受控，不要直接把 Node HTTP listener 暴露到公网。

```env
LARK_TRANSPORT=webhook
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=...
LARK_DOMAIN=feishu
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
LARK_EVENT_DEDUP_WINDOW_MS=43200000
LARK_EVENT_DEDUP_MAX_ENTRIES=5000
```

上线前逐项确认：

1. 反向代理只把预期路径转发到 listener，并保留原始请求体、`content-type`、`x-lark-request-timestamp`、`x-lark-request-nonce` 和 `x-lark-signature`。
2. 公网入口使用有效 TLS 证书；HTTP 重定向不能吞掉 POST body，代理层也不要改写 JSON。
3. 在开放平台保存回调 URL 时，URL verification challenge 返回成功；进程日志显示 listener 已绑定到预期 host、port 和 path。
4. 使用错误 verification token 的请求必须得到通用 `400`；启用 encrypt key 后，错误签名或错误 encrypt key 也必须得到通用 `400`。响应和日志都不得回显 secret。
5. 非 POST 请求得到 `405`，错误路径得到 `404`，非法 JSON 得到通用 `400`。
6. 超过 `LARK_WEBHOOK_MAX_BODY_BYTES` 的请求得到 `413`；同时确认反向代理自身的 body limit 不低于应用限制，否则应明确由哪一层拒绝。
7. 慢请求头、迟迟不结束的请求体和空闲 keep-alive 连接分别受 `LARK_WEBHOOK_HEADERS_TIMEOUT_MS`、`LARK_WEBHOOK_REQUEST_TIMEOUT_MS`、`LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS` 限制；请求头超时不得大于完整请求超时，反向代理的对应超时应与应用边界协调。
8. 若配置了 encrypt key，使用开放平台的加密事件完成一次真实解密分发；不要仅验证未加密 challenge。
9. 使用同一个 `event_id` 重放一条已验证事件，确认只执行一次；再使用新 `event_id` 发送相同业务内容，确认不会被误判为重复。
10. 监控使用 `GET LARK_WEBHOOK_HEALTH_PATH`；连接正常时返回不含凭证的 `200` JSON。不要向回调路径发送 GET 并把预期的 `405` 当故障。反向代理可只将健康路径暴露给内部探针，并且必须确保健康路径与回调路径不同。
11. verification token、encrypt key、App Secret、完整签名请求和解密后的敏感消息体不得写入仓库或普通访问日志。

## 真实凭证 smoke

私聊中的普通 prompt、带参数原生命令和未知 `/path` 回退可先用无写入预检确认自动化条件：

```bash
npm run smoke:lark-dm
```

默认不会发送消息。预检要求同一 `lark-cli` profile 的 bot/user identity 均 ready，且 user identity 已由用户交互授权 `im:message.send_as_user`。授权属于额外 smoke 驱动权限，不是 bot 生产运行权限；项目不会自动发起或扩大 OAuth 授权。确认隔离私聊中只有一个 bot consumer 后，显式执行：

```bash
npm run smoke:lark-dm -- --apply
```

工具依次发送普通 prompt、带 `status` 参数的 provider 前缀原生命令和未知 `/path` prompt，并按关联回复自动核验。报告仅包含 identity/scope 布尔值、用例名、轮询次数和耗时，不输出 app/chat/user/message ID、profile 名称、凭证或消息正文。

2026-07-27 的 CLI transport 隔离验收已完成这三个自动用例；同日群聊 smoke 还完成了步骤 4、11、12 和 15，其中新建 side 的根消息为无控件原生卡片，关闭后在同一消息 ID 上原位显示 `🔒 Codex side conversation closed`。不要复用旧的普通文本根来判断关闭标记修复是否生效。该测试群的 bot tenant token 调用飞书“列群历史消息”接口会返回 `230027 / user_unauthorized`，因此 fork 的可选“最近一次 agent 输出”重放会无警告跳过；新根、fork session、origin notice 和后续链内消息不受影响。

在隔离测试 chat 中依次验证：

1. `npm run check:lark -- --verify-credentials` 的自动检查通过；逐项完成输出中的 `Manual checks still required`，且没有未处理的 allowlist、公开 Webhook listener 或未加密事件警告。
2. 启动后所选 transport 成功：SDK/CLI 长连接不进入重试循环，或 Webhook listener 正确监听且 challenge 已通过；发送 `!status`，平台连接显示为已连接且 transport 正确。
3. 私聊发送普通 prompt，bot 能回复。
4. 群聊 @ bot，bot 能回复；未 @ 消息遵守当前 mention-only 策略。
5. 发送 `!settings`，卡片可显示，button/select 点击后能原位更新。
6. 让不具备操作权限的用户点击共享卡片，拒绝结果应只发送到该用户与 bot 的私聊，共享卡片内容保持不变。
7. 从群聊或 reply chain 触发一个带后续控件的非表单私密响应（可从 Onboarding 点击 workspace browse），确认私聊卡片中的 button/select 仍读写原群聊会话，而更新只发生在私聊卡片；在生成私聊卡片后重启一次进程再点击，以覆盖内存 target cache 丢失后的上下文恢复。
8. 从 Settings 打开自定义 model、Codex profile 或 compact 阈值输入；Card 2.0 表单能在当前卡片原位显示，提交后保存值并刷新当前卡片。
9. 点击至少一个事件型机器人菜单（建议 `status` 或 `settings`），结果能发送到操作者与 bot 的私聊并原位更新。
10. 执行 provider 对应的原生 slash command（例如 `/cx_status`），确认它通过当前 chat/reply chain 会话返回结果；再执行一个带参数的命令，确认参数与同名 `!command` 一致。未知的 `/path` 文本不能被误识别为命令。
11. 发送带图片的 prompt，资源能下载并作为原生图片输入传给 Codex。
12. 启动长任务后发送 `!cancel`，任务终止且状态 reaction 正确更新。
13. 临时断网后恢复，能看到 reconnect 日志并继续接收消息；再次发送 `!status`，重试/自愈指标与实际过程一致。
14. 连续发送和更新数条消息后执行 `!status`，消息投递成功/失败/进行中计数合理；若 smoke 中出现投递失败，最近失败原因可见且不包含凭证。
15. 在群聊执行一次 Codex/Claude `fork`，确认新根消息和 reply chain 使用独立会话；再执行一次 Codex `side`，确认 side session 绑定、消息投递和关闭根标记都正常。私聊执行相同命令时应明确降级，不创建子会话。
16. Webhook 模式额外验证真实签名事件、加密事件、机器人菜单、原生 slash command 和卡片 action 都经过预期入口，并在重启反向代理或应用后继续可用。
17. 向进程发送一次 `SIGTERM`，确认当前任务被取消、SDK/CLI/Webhook channel 正常断开、Webhook 端口释放且没有退出期自愈重启；即使临时设置 `SELF_HEAL_ENABLED=false`，优雅退出也必须保持生效。

凭证、测试 chat ID 和用户 ID 不进入仓库。真实 smoke 完成后只记录应用版本、时间、region、transport、公开 callback host（不含 token/query secret）和各步骤结果。
