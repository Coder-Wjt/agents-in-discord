# Agents in Discord

A standalone bridge that lets you direct **Codex CLI**, **Claude Code**, **Antigravity CLI**, **ZCode CLI**, **Pi Agent**, and **Oh My Pi** from Discord or Feishu/Lark, with an optional WeChat Codex entry.

> This project is a standalone chat bridge. It is **not** an OpenClaw plugin, and it does **not** depend on OpenClaw to run.

[简体中文](./README.md)

**Maintainers:** [ATou](https://github.com/atou42) and [Lark](https://github.com/Larkspur-Wang).

ZCode CLI support is available starting with [v0.13.0](https://github.com/atou42/agents-in-discord/releases/tag/v0.13.0).

**Design:** 1 platform conversation (a Discord thread/channel or Lark chat/reply chain) = 1 CLI session (auto resume for the active provider).

## Features

- Native Discord and provider-prefixed Lark slash commands, with text-command fallbacks
- Thread-level session persistence (restart-safe)
- Flexible workspace model: thread override, provider default, plus legacy per-thread fallback
- Provider-aware runtime surface:
  - Codex: rollout sessions, global `~/.codex/sessions` history, raw config passthrough, configurable `native_limit`
  - Claude: project sessions, portable resume across workspaces, provider-default native compaction
  - Antigravity: conversations, workspace-bound resume, provider-default native compaction, model choices merged from local Antigravity settings, documented reasoning models, and observed CLI logs
  - ZCode: headless JSON runs, file attachments, workspace-bound resume, and rollout history from `~/.zcode/cli/rollout`
- Self-healing runtime: auto relogin with backoff after transient Discord/runtime failures
- Workspace-level serialization so the same workspace is never executed concurrently across channels/bots
- Two modes:
  - `safe` → sandboxed Codex exec (`--sandbox workspace-write` + `approval_policy=on-request` + `approvals_reviewer=auto_review`)
  - `dangerous` → `--dangerously-bypass-approvals-and-sandbox` (full access)
- Optional proxies (Clash / corp proxy): REST via `HTTP_PROXY`, Gateway WS via `SOCKS_PROXY`
- Lightweight UX:
  - reacts `⚡` when starting, `✅` on success, `❌` on failure, `🛑` when cancelled
  - `/name` to label a session
  - per-channel prompt queue (messages are queued instead of rejected)
  - `/cancel` / `/abort` / `!cancel` / `!c` / `!abort` to interrupt the current run and clear queued prompts
  - long-run live progress updates (phase/elapsed/latest step), plus `/progress` / `!progress`
  - `/doctor` / `!doctor` for runtime + security diagnostics
  - `/onboarding` ordinary-user first-run guide: language, provider, workspace, ready; the workspace step can open the browser directly, with `!onboarding` as a text fallback
  - slash replies stay text-first by default; use `/status`, `/queue`, `/progress`, or `/cancel` explicitly when you need them
  - per-thread onboarding switch (`on/off/status`) and message language (`zh/en`, default `zh`)
  - per-thread security profile override (`auto|solo|team|public`)
  - per-thread runner timeout override (`ms|off|status`)

Discord keeps its full slash-command surface. Lark is message-first but also supports registered provider-prefixed native slash commands, text commands, native card buttons, selects, and Card 2.0 forms.

## Prerequisites

- Node.js 18+
- Install the CLI(s) you plan to use
  - Codex: `codex` available in shell, or set `CODEX_BIN=/absolute/path/to/codex`
  - Claude: `claude` available in shell, or set `CLAUDE_BIN=/absolute/path/to/claude`
  - Antigravity: `agy` available in shell, or set `ANTIGRAVITY_BIN=/absolute/path/to/agy`
  - ZCode: `zcode` available in shell, or set `ZCODE_BIN=/absolute/path/to/zcode`
  - Pi Agent: `pi` available in shell, or set `PI_BIN=/absolute/path/to/pi`
  - Oh My Pi: `omp` available in shell, or set `OMP_BIN=/absolute/path/to/omp`
- If the CLI itself needs login, complete that in the CLI first; this project does not manage provider auth in `.env`
- Discord Application/Bot token(s), or Feishu/Lark authentication
  - Discord shared mode needs one bot token
  - Discord dedicated mode can use separate tokens for Codex, Claude, Antigravity, ZCode, Pi, and OMP bots
  - Local Lark CLI mode can reuse the encrypted persistent `lark-cli` login
  - Lark SDK/Webhook mode needs an app ID and app secret

The Lark integration is verified on Node.js `v18.17.1`; it does not require a Node.js 22 upgrade.

## Quickstart

```bash
git clone https://github.com/atou42/agents-in-discord.git
cd agents-in-discord
cp .env.example .env
npm install
npm run setup-hooks
npm start
```

Git hooks note:

- Run `npm run setup-hooks` once after clone (or after re-clone).
- The pre-commit atomic check is Node-based and works on macOS/Linux/Windows (no bash required).

Then in your Discord server, invite the bot. For a normal first run, start with `/cx_onboarding`, choose language/provider/workspace, then send the first task.

### Optional WeChat entry

The WeChat entry runs as a separate process, so the existing Discord startup path, tokens, channel sessions, and components remain unchanged. Both entries reuse the Codex runner and the same workspace lock directory.

```env
WECHAT_WORKSPACE_ROOTS=~/GitHub,~/Lark_Project
WECHAT_DEFAULT_WORKSPACE_DIR=~/GitHub
WECHAT_CODEX_RUNTIME_MODE=long
WECHAT_ALLOW_DANGEROUS=false
```

Start it with `npm run start:wechat` and scan the terminal QR code. Use `/sessions`, `/resume <number|thread-id>`, `/session`, `/new`, `/status`, `/cancel`, and `/dir <path>` in WeChat. The first version accepts text and voice transcription, but not image or file inputs.

### Run Discord and WeChat continuously on macOS

The two entries use independent `launchd` services. They start at login and restart after an unexpected exit:

```bash
# 1. Configure .env and at least set CODEX__DISCORD_TOKEN
cp .env.example .env

# 2. Complete the initial WeChat QR login in the foreground, then press Ctrl-C
npm run start:wechat

# 3. Install and start both background services
npm run services:install
```

Use `npm run services:status`, `npm run services:logs`, and `npm run services:restart` for routine operations. Pass `discord` or `wechat` directly to `scripts/manage-channel-services-macos.sh` to operate on only one entry.

WeChat credentials and channel bindings live under `data/wechat/`, separately from Discord state. The iLink protocol implementation was informed by the MIT-licensed [sgaofen/cli-in-wechat](https://github.com/sgaofen/cli-in-wechat); its CLI adapter and `resume --last` session model are not used.

Examples below use the default Codex/shared prefix `cx_`; a dedicated Claude bot defaults to `cc_`, a dedicated Antigravity bot defaults to `ag_`, and a dedicated ZCode bot defaults to `zc_`. All can be overridden with `SLASH_PREFIX` or the matching provider-scoped `__SLASH_PREFIX` key:

- `/cx_status` — show current thread config
- `/cx_settings` — open the interactive channel settings panel for provider, model, fast mode, effort, compact, mode, language, and workspace
- `/cx_setdir <path|default|status>` — set or clear workspace for current thread
- `/cx_setdefaultdir <path|clear|status>` — set provider default workspace
- `/cx_model` — open a compact model panel with CLI-read model choices, custom model input, and effort controls
- `/cx_model name:<name|default> effort:<...>` — set model and reasoning effort directly; `name` and `effort` are both optional
- `/cx_fast <on|off|status|default>` — toggle Codex Fast mode for the current channel; only exposed for Codex, and `default` falls back to `[features].fast_mode` in `~/.codex/config.toml`, which now defaults to on when unset
- `/cx_effort <...>` — compatibility shortcut for reasoning effort; prefer `/cx_model` for normal use
- `/cx_compact key:<...> value:<...>` — configure compact for the current channel; every provider supports `strategy|token_limit|enabled|reset|status`, while `native_limit` only works where the provider exposes a native limit override (currently mainly Codex)
- `/cx_mode <safe|dangerous>` — set execution mode
- `/cx_name <label>` — name the session (for display)
- `/cx_new` — switch to a fresh session while keeping current channel settings
- `/cx_reset` — clear current thread session and extra config overrides
- `/cx_resume <session_id>` — bind an existing provider-native session id
- `/cx_sessions` — list recent provider-native sessions from the runtime store
- `/cx_queue` — show running/queued task count in current channel
- `/cx_doctor` — show bot runtime/security diagnostics
- `/cx_onboarding` — ordinary-user first-run guide (language/provider/workspace/ready, ephemeral)
- `/cx_onboarding_config <on|off|status>` — configure onboarding availability in current channel
- `/cx_language <中文|English>` — set bot message hint language in current channel
- `/cx_profile <auto|solo|team|public|status>` — set or view current channel security profile override
- `/cx_timeout <ms|off|status>` — set current channel runner timeout override
- `/cx_progress` — show latest progress snapshot for the running task
- `/cx_abort` — interrupt current run and clear queued prompts (legacy alias)
- `/cx_cancel` — interrupt current run and clear queued prompts; text aliases: `!cancel` / `!c`, with `!abort` / `!stop` kept for compatibility

Common text-command aliases:

- `!cancel`, `!c`, `!abort`, and `!stop` all interrupt the current run and clear queued prompts
- `!fast <on|off|status|default>` overrides Codex Fast mode for the current channel; `default` inherits `~/.codex/config.toml`

Provider-native session aliases:

- Codex: `/cx_rollout_sessions`, `/cx_rollout_resume`
- Claude: `/cc_project_sessions`, `/cc_project_resume`
- Antigravity: `/ag_conversation_sessions`, `/ag_conversation_resume`
- ZCode: `/zc_zcode_sessions`, `/zc_zcode_resume`
- The canonical `/cx_sessions`, `/cx_resume`, `!sessions`, and `!resume` still work; dedicated bots narrow the help text to the current provider's native terminology

## Feishu/Lark integration

The Lark integration supports two WebSocket transports and one HTTP webhook transport on Node.js 18:

- `LARK_TRANSPORT=cli` reuses encrypted credentials persisted by the official `lark-cli`, which is convenient for local use and keeps the App Secret out of the project `.env`.
- `LARK_TRANSPORT=sdk` uses the official `@larksuiteoapi/node-sdk` with environment credentials, which is suitable for servers and external secret stores.
- `LARK_TRANSPORT=webhook` uses the official SDK dispatcher for HTTPS callbacks. It always checks the verification token and, when an encrypt key is configured, also verifies signatures and decrypts encrypted events.

`LARK_TRANSPORT=auto` is the default: it selects SDK WebSocket when both `LARK_APP_ID` and `LARK_APP_SECRET` are configured, otherwise it selects the CLI. Webhook mode must be selected explicitly. One-time CLI setup:

```bash
npm install -g @larksuite/cli
lark-cli config init --new
lark-cli auth login --recommend
lark-cli auth status --verify --json
```

Run the read-only preflight before starting. The default command checks effective configuration and the local SDK/CLI only. With `--verify-credentials`, CLI mode verifies the selected profile, while SDK/webhook mode obtains a tenant token and reads bot info. Neither form starts event consumers, opens the webhook listener, sends messages, or prints credential values:

```bash
npm run check:lark
npm run check:lark -- --verify-credentials
npm run sync:lark-commands
npm run sync:lark-commands -- --dry-run
# Only after reviewing the read-only drift:
# npm run sync:lark-commands -- --apply
```

Then start the runtime:

```bash
npm run start:lark
```

For SDK WebSocket or webhook mode, enable the bot capability in the developer console, subscribe to `im.message.receive_v1` (and `application.bot.menu_v6` when using native bot menus) plus the `card.action.trigger` callback, grant the permissions needed to receive messages, send/update/recall as the bot, read message resources, and read/write reactions, then configure:

See [`docs/lark-deployment-checklist.md`](docs/lark-deployment-checklist.md) for the versioned scope/event baseline and the real-credential smoke procedure. `check:lark -- --verify-credentials` also reads the published bot version, WebSocket/webhook delivery mode, published events, required bot-menu `event_key` values, and native slash-command registry without starting a consumer or sending messages, and requires at least one chat, tenant, or user allowlist. An empty allowlist does not skip the remaining remote checks, but the final readiness result cannot pass. An enabled menu with missing command keys or an unreadable required native slash-command registry also fails readiness. If the application API omits the card-callback subscription list, the report keeps that item as an explicit manual check instead of claiming it passed. `sync:lark-commands` is read-only by default and checks both slash-command provisioning scopes; `--dry-run` validates every planned create/update request without writing. Explicit `--apply` runs the same complete validation pass first, then creates missing commands, updates outdated descriptions, and never deletes extra commands. A missing read scope is never misreported as an empty registry, while pending dry-run/apply work is rejected before execution when the write scope is absent. Before writing, the tool also checks the 100-command per-app limit and refuses a partial sync when the registry has insufficient capacity.

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

For webhook mode, point both the event subscription and card callback at the same public HTTPS URL. The process listens on loopback by default so a reverse proxy can terminate TLS:

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

The reverse proxy must preserve the raw request body and `x-lark-*` headers. The listener separately bounds header receipt, complete request receipt, and idle keep-alive time so slow clients cannot occupy sockets indefinitely; the header timeout cannot exceed the complete request timeout. The deployment checklist covers public TLS, URL challenge verification, invalid signatures, body-size limits, and timeouts.

Use `LARK_CLI_PROFILE` to select a profile when the CLI has multiple apps, and `LARK_CLI_BIN` to override the executable path. Use `LARK_DOMAIN=feishu` for mainland Feishu and `LARK_DOMAIN=lark` for international Lark; these domain settings apply to SDK WebSocket and webhook mode, while CLI mode follows the selected profile's brand.

The integration supports group mentions, DMs, ordinary messages, text commands such as `!status`, `!progress`, and `!cancel`, attachment metadata, native Codex image downloads, progress-message edits, task-status reactions, bounded event deduplication, and transport self-healing. Messages, card actions, and bot-menu events are deduplicated by stable event identity so webhook or CLI redelivery cannot execute the same task twice; tune the retention window and memory bound with `LARK_EVENT_DEDUP_WINDOW_MS` and `LARK_EVENT_DEDUP_MAX_ENTRIES`. Webhook mode also exposes a read-only GET health probe on a path separate from the callback POST endpoint. On `SIGTERM` or `SIGINT`, active work is cancelled and the SDK, CLI, or webhook channel is disconnected even when `SELF_HEAL_ENABLED=false`; shutdown failures cannot schedule a self-heal restart. `!status` reports the selected transport's connection state, retry/self-heal counts, and message-delivery successes, failures, in-flight operations, and the latest failure. Settings, onboarding, workspace browsing, workspace-conflict actions, and retry controls can use native Lark cards with buttons and selects. Shared modals for model, Codex profile, and compact-threshold input are rendered as inline Card 2.0 forms; opening and submitting them updates the current card in place. Reply chains are isolated by `root_id`; local state and locks are isolated by `BOT_PLATFORM` and `BOT_INSTANCE_ID`.

SDK, CLI, and webhook transports support card actions. CLI mode consumes `im.message.receive_v1`, `card.action.trigger`, and `application.bot.menu_v6`; webhook mode dispatches them through the same verified HTTP endpoint. Lark does not reuse Discord's popup modal UI; Card 2.0 forms provide the equivalent input flow. Non-form `ephemeral` responses triggered from a group card are sent to the operator's bot DM instead of replacing the shared card. The private card carries the qualified source chat or reply-chain context, so its buttons, selects, and forms continue to operate on the original session even after a process restart, while card updates remain private. Card 2.0 forms still open and submit in place on the current card to preserve validation, correction, and retry behavior. Event-style custom bot menus can use shared command names as their `event_key` (for example `status`, `settings`, `progress`, `queue`, `cancel`, `new`, or `onboarding`); results are delivered to the operator's bot DM and updated in place. Native slash commands follow the provider-aware prefix used on Discord, for example `/cx_status`, `/cc_status`, `/ag_status`, `/zc_status`, `/pi_status`, or `/omp_status`; their ordinary message deliveries reuse the existing text-command parser and arguments. In group chats, `fork` and Codex `side` create a new root message and isolate subsequent work in its reply chain; closing a side conversation marks that root as closed. DMs cannot create these child conversations. Apps must register commands and enable the matching events/callbacks for native entries to work.

If you want **separate Discord bots** for Codex, Claude, Antigravity, ZCode, Pi, and OMP, keep everything in one `.env`, but group provider-specific values with clear prefixes:

```bash
# one-time setup
cp .env.example .env

# start dedicated bots
npm run start:codex
npm run start:claude
npm run start:antigravity
npm run start:zcode
npm run start:pi
npm run start:omp
```

Use plain keys for shared Discord/runtime settings, then put dedicated bot settings under `CODEX__*`, `CLAUDE__*`, `ANTIGRAVITY__*`, `ZCODE__*`, `PI__*`, and `OMP__*` sections in the same file. In practice, you usually only need `DISCORD_TOKEN`, optional `DEFAULT_MODEL`, optional `DEFAULT_MODE`, and optional CLI path overrides. Pi and OMP share a compatibility layer while keeping their session stores, resume flags, and permission flags separate. Each locked instance uses its own provider-scoped state file and process lock, so channel/session context does not mix across bots.

Lark can also be combined with `BOT_PROVIDER=codex|claude|antigravity|zcode|pi|omp`; for example, `CODEX__LARK_TRANSPORT`, `CODEX__LARK_CLI_PROFILE`, or `CODEX__LARK_APP_ID` / `CODEX__LARK_APP_SECRET` override the shared Lark settings, and the other provider prefixes work the same way.

## Configuration (.env)

See `.env.example`.

Important knobs:

- `BOT_PLATFORM`: `discord` (default) or `lark`; `npm run start:lark` sets `lark`
- `BOT_INSTANCE_ID`: stable instance name used to isolate session files and process/workspace locks
- `LARK_TRANSPORT`: `auto` (default), `cli`, `sdk`, or `webhook`; auto selects CLI when SDK credentials are absent and never selects webhook implicitly
- `LARK_CLI_BIN` / `LARK_CLI_PROFILE`: CLI executable and optional persistent credential profile
- `LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_DOMAIN`: SDK credentials and `feishu|lark` region selection
- `LARK_WEBHOOK_VERIFICATION_TOKEN` / `LARK_WEBHOOK_ENCRYPT_KEY`: webhook verification and optional encrypted-event key
- `LARK_WEBHOOK_HOST` / `LARK_WEBHOOK_PORT` / `LARK_WEBHOOK_PATH` / `LARK_WEBHOOK_HEALTH_PATH` / `LARK_WEBHOOK_MAX_BODY_BYTES`: local webhook listener, separate GET health probe, and request-size limit
- `LARK_WEBHOOK_HEADERS_TIMEOUT_MS` / `LARK_WEBHOOK_REQUEST_TIMEOUT_MS` / `LARK_WEBHOOK_KEEP_ALIVE_TIMEOUT_MS`: slow-header, complete-request, and idle keep-alive bounds for the webhook HTTP server
- `LARK_EVENT_DEDUP_WINDOW_MS` / `LARK_EVENT_DEDUP_MAX_ENTRIES`: duplicate event retention and bounded in-memory cache size
- `LARK_ALLOWED_CHAT_IDS` / `LARK_ALLOWED_TENANT_IDS` / `LARK_ALLOWED_USER_IDS`: Lark access control; falls back to the corresponding shared allowlist when unset
- `LARK_MENTION_ONLY_CHAT_IDS`: Lark chats that require a bot mention for normal prompts
- `ALLOWED_CHANNEL_IDS` / `ALLOWED_USER_IDS`: lock the bot down (recommended); dedicated bots can also use `CODEX__ALLOWED_*` / `CLAUDE__ALLOWED_*` / `ANTIGRAVITY__ALLOWED_*` / `ZCODE__ALLOWED_*` / `PI__ALLOWED_*` / `OMP__ALLOWED_*`
- Shared `.env` keys: Discord/runtime settings only (`ALLOWED_*`, `WORKSPACE_ROOT`, `DEFAULT_WORKSPACE_DIR`, proxy, etc.)
- `CODEX__*`: Codex bot section in the same `.env` (normally `CODEX__DISCORD_TOKEN`, plus optional `CODEX__DEFAULT_MODEL`, `CODEX__DEFAULT_MODE`, `CODEX__DEFAULT_WORKSPACE_DIR`, `CODEX__MAX_INPUT_TOKENS_BEFORE_COMPACT`, `CODEX__CODEX_BIN`)
- `CLAUDE__*`: Claude bot section in the same `.env` (normally `CLAUDE__DISCORD_TOKEN`, plus optional `CLAUDE__DEFAULT_MODEL`, `CLAUDE__DEFAULT_MODE`, `CLAUDE__DEFAULT_WORKSPACE_DIR`, `CLAUDE__CLAUDE_BIN`)
- `ANTIGRAVITY__*`: Antigravity bot section in the same `.env` (normally `ANTIGRAVITY__DISCORD_TOKEN`, plus optional `ANTIGRAVITY__DEFAULT_MODE`, `ANTIGRAVITY__DEFAULT_WORKSPACE_DIR`, `ANTIGRAVITY__SLASH_PREFIX`)
- `ZCODE__*`: ZCode bot section in the same `.env` (normally `ZCODE__DISCORD_TOKEN`, plus optional `ZCODE__DEFAULT_MODE`, `ZCODE__DEFAULT_WORKSPACE_DIR`, `ZCODE__SLASH_PREFIX`)
- `BOT_PROVIDER`: leave empty for shared mode, or set `codex` / `claude` / `antigravity` / `zcode` to lock one bot instance to a single provider; the matching `npm run start:*` command sets this automatically
- `ENV_FILE`: optional extra overlay file if you really need one, but the normal setup is now a single grouped `.env`
- `DISCORD_TOKEN_CODEX` / `DISCORD_TOKEN_CLAUDE` / `DISCORD_TOKEN_ZCODE`: legacy fallback for older single-file setups
- Provider auth is outside this project's config surface; keep CLI-specific login or secrets outside this `.env` unless you intentionally need them for your own runtime
- `SECURITY_PROFILE`: `auto | solo | team | public`
  - `auto`: DM -> `solo`; guild channel where `@everyone` can view -> `public`; else `team`
- `MENTION_ONLY`: require bot mention for normal messages (leave empty to use profile default)
- `MENTION_ONLY_ENABLED_GUILD_IDS`: comma-separated guild IDs; these guilds always require mentioning the bot for normal messages, overriding `MENTION_ONLY`
- `MENTION_ONLY_DISABLED_GUILD_IDS`: comma-separated guild IDs; these guilds allow normal messages without mentioning the bot, overriding `MENTION_ONLY`
- `MAX_QUEUE_PER_CHANNEL`: max queued prompts per channel (`0` = unlimited; leave empty to use profile default)
- `ENABLE_CONFIG_CMD`: enable/disable `!config` command (default `false`)
- `CONFIG_ALLOWLIST`: allowed keys for `!config key=value` (comma-separated, or `*` to allow all)
- `SLASH_PREFIX`: shared/global slash prefix; default `cx` in shared mode (e.g. `/cx_status`)
- `CODEX__SLASH_PREFIX` / `CLAUDE__SLASH_PREFIX` / `ANTIGRAVITY__SLASH_PREFIX` / `ZCODE__SLASH_PREFIX` / `PI__SLASH_PREFIX` / `OMP__SLASH_PREFIX`: dedicated-bot slash prefix overrides; defaults are `cx`, `cc`, `ag`, `zc`, `pi`, and `omp`
- `DEFAULT_UI_LANGUAGE`: default bot message language for new channels (`zh` or `en`, default `zh`)
- `SHOW_REASONING`: stream model reasoning summaries onto the progress card (default `false`). The CLI has to emit reasoning events as well — for Codex, set `model_reasoning_summary = "detailed"` in `~/.codex/config.toml`. Note that `gpt-5.6` models (sol/terra/luna) emit no reasoning events under codex-cli 0.144.0, since their `models_cache.json` entries omit the `supports_reasoning_summaries` field the CLI requires; `gpt-5.4` does emit them.
- `ONBOARDING_ENABLED_DEFAULT`: onboarding default for new channels (`true` or `false`, default `true`)
- `DEFAULT_MODE`: `safe` or `dangerous`; the example `.env` now uses **`dangerous` by default** so local devs get full power out of the box. For shared / prod servers you should:
  - change `CODEX__DEFAULT_MODE` / `CLAUDE__DEFAULT_MODE` / `ANTIGRAVITY__DEFAULT_MODE` / `ZCODE__DEFAULT_MODE` / `PI__DEFAULT_MODE` / `OMP__DEFAULT_MODE` back to `safe` in `.env`, and only enable dangerous mode in trusted channels; or
  - run the bot in a private guild where you trust all members
- `DEFAULT_WORKSPACE_DIR`: optional shared default workspace for all providers
- `CODEX__DEFAULT_WORKSPACE_DIR` / `CLAUDE__DEFAULT_WORKSPACE_DIR` / `ANTIGRAVITY__DEFAULT_WORKSPACE_DIR` / `ZCODE__DEFAULT_WORKSPACE_DIR` / `PI__DEFAULT_WORKSPACE_DIR` / `OMP__DEFAULT_WORKSPACE_DIR`: provider-specific default workspaces that override the shared default
- `CHILD_THREAD_WORKSPACE_MODE`: child thread workspace strategy; `inherit` reuses the parent channel's explicit workspace, while `separate` makes each child thread use its own provider default or `WORKSPACE_ROOT/<threadId>` fallback
- `WORKSPACE_ROOT`: legacy fallback root used only when neither thread override nor provider default is configured
- `CODEX_BIN`: codex command/path (default `codex`)
- `CLAUDE_BIN`: claude command/path (default `claude`)
- `ANTIGRAVITY_BIN`: agy command/path (default `agy`)
- `ZCODE_BIN`: zcode command/path (default `zcode`)
- `PI_BIN`: Pi command/path (default `pi`)
- `OMP_BIN`: OMP command/path (default `omp`)
- Codex provider defaults for `model`, `effort`, and `fast mode` are read from `~/.codex/config.toml`; unless `[features].fast_mode = false` is set explicitly, fast mode defaults to on, and channel-level `!model`, `!effort`, and `!fast` only override the current thread
- `CODEX_TIMEOUT_MS`: default runner hard timeout (ms). Today all providers share this default; `0` disables timeout, and `/cx_timeout` / `!timeout` can still override it per thread.
- `PROGRESS_UPDATES_ENABLED`: enable/disable live progress updates in channel (default `true`)
- `PROGRESS_UPDATE_INTERVAL_MS`: heartbeat refresh interval for progress message
- `PROGRESS_EVENT_FLUSH_MS`: min interval for event-triggered progress edits
- `PROGRESS_EVENT_DEDUPE_WINDOW_MS`: dedupe window for semantically identical progress events (stdout + rollout bridge), in ms (default `2500`)
- `PROGRESS_TEXT_PREVIEW_CHARS`: truncation length for “latest step” preview
- `PROGRESS_INCLUDE_STDOUT`: include non-JSON stdout lines in progress activity (default `true`)
- `PROGRESS_INCLUDE_STDERR`: include raw stderr lines in progress preview (noisy; default `false`)
- `PROGRESS_PLAN_MAX_LINES`: max plan lines shown in progress (default `4`)
- `PROGRESS_DONE_STEPS_MAX`: max completed key steps shown in progress (default `4`)
- `PROGRESS_ACTIVITY_MAX_LINES`: max recent activity lines shown in progress/status (default `4`)
- `PROGRESS_MESSAGE_MAX_CHARS`: max rendered chars per progress message (default `1800`)
- `SELF_HEAL_ENABLED`: enable runtime self-healing (default `true`)
- `SELF_HEAL_RESTART_DELAY_MS`: delay before self-heal restart (default `5000`)
- `SELF_HEAL_MAX_LOGIN_BACKOFF_MS`: max retry backoff for Discord login or Lark channel connection (default `60000`)
- `MAX_INPUT_TOKENS_BEFORE_COMPACT`: compact threshold
- `COMPACT_STRATEGY`: `hard | native | off`
  - `hard`: bot summarizes then switches to a new session
  - `native`: use provider-native compaction and continue the same session
  - `off`: disable compact behavior
- You can also override compact strategy per channel with `/cx_compact` or `!compact`
- `COMPACT_ON_THRESHOLD`: enable/disable threshold-triggered compact logic
- Channel-level compact config supports: `strategy`, `token_limit`, `native_limit`, `enabled`, `reset`, and `status`

## Auto-upgrade Codex CLI (Optional Scheduler Adapter)

This repo includes a cross-platform updater for `codex` that can:

- check for updates on a schedule
- auto-upgrade `codex`
- restart your bot service after a successful upgrade

Install (auto-select scheduler by OS: macOS=`launchd`, Windows=`Task Scheduler`, others=`none`):

```bash
npm run install:auto-upgrade
```

Custom schedule (example: every day at `03:40`):

```bash
SCHEDULE_HOUR=3 SCHEDULE_MINUTE=40 npm run install:auto-upgrade
```

Disable scheduler but keep manual updater:

```bash
AUTO_UPGRADE_SCHEDULER=none npm run install:auto-upgrade
```

Manual run (for smoke test):

```bash
npm run run:auto-upgrade
```

Manual run (dry-run; no package/service changes):

```bash
CODEX_UPGRADE_DRY_RUN=1 npm run run:auto-upgrade
```

macOS note:

- The upgrader now treats `brew update` as best-effort; if an unrelated tap times out, it still checks/upgrades the target cask
- Set `CODEX_UPGRADE_SKIP_BREW_UPDATE=1` to skip the explicit `brew update` step entirely

### macOS (`launchd`)

Default IDs:

- Upgrade service label: `com.atou.agents-in-discord.auto-upgrade` (`LABEL`)
- Bot service label: `com.atou.agents-in-discord` (`BOT_LABEL`)

If you manage bot services manually:

- The runtime now blocks dangerous `launchctl` operations for protected bot labels, or rewrites them to a safe restart helper
- Prefer `scripts/restart-discord-bot-service.sh <codex|claude|antigravity|zcode|pi|omp|wechat|all>`

Check service and logs:

```bash
launchctl print gui/$(id -u)/com.atou.agents-in-discord.auto-upgrade
tail -n 100 logs/agents-in-discord.auto-upgrade.log
tail -n 100 logs/agents-in-discord.auto-upgrade.err.log
```

Remove service:

```bash
launchctl bootout gui/$(id -u)/com.atou.agents-in-discord.auto-upgrade
rm -f ~/Library/LaunchAgents/com.atou.agents-in-discord.auto-upgrade.plist
```

### Windows (`Task Scheduler`)

PowerShell install (equivalent to `npm run install:auto-upgrade`):

```powershell
$env:SCHEDULE_HOUR='5'
$env:SCHEDULE_MINUTE='15'
$env:TASK_NAME='agents-in-discord-auto-upgrade'
$env:BOT_TASK_NAME='agents-in-discord'
node scripts/install-agents-in-discord-auto-upgrade.mjs
```

Defaults:

- Upgrade task name: `agents-in-discord-auto-upgrade` (`TASK_NAME` or `LABEL`)
- Bot restart task: `agents-in-discord` (`BOT_TASK_NAME` or `BOT_LABEL`)

Inspect/remove task:

```powershell
schtasks /Query /TN "agents-in-discord-auto-upgrade" /V /FO LIST
schtasks /Delete /TN "agents-in-discord-auto-upgrade" /F
```

## Troubleshooting

### `spawn codex ENOENT`

This means the bot process cannot find the Codex CLI executable in its runtime environment.

1. Check the installed path on that machine:
```bash
which codex
```
2. Put the absolute path into `.env`:
```env
CODEX_BIN=/opt/homebrew/bin/codex
```
Windows example (PowerShell path):
```env
CODEX_BIN=C:\\Users\\<you>\\AppData\\Local\\Programs\\Codex\\codex.exe
```
3. Restart the bot process.

You can also run `/cx_status` (or your active slash prefix + `_status`, such as `/cc_status` on the default Claude bot) to see codex-cli health in bot output.

## Proxy / Clash setup (optional)

If you are behind a proxy:

- Discord REST API: set `HTTP_PROXY=http://127.0.0.1:7890`
- Discord Gateway WebSocket: set `SOCKS_PROXY=socks5h://127.0.0.1:7891`

This repo includes a **best-effort patch script** for `@discordjs/ws` (run automatically on `npm install`) so the Gateway can use a custom agent:

```bash
npm run patch-ws
```

If your HTTP proxy does TLS MITM and you *must* bypass verification:

```env
INSECURE_TLS=1
```

(Strongly discouraged. Prefer a clean SOCKS tunnel.)

## Local one-shot channel send

If you want to post a message to a Discord channel from the local shell or another automation flow, use:

```bash
npm run send:channel -- --channel 1487823042121040036 --content "Deploy finished"
```

It also supports multi-line input and provider-scoped tokens:

```bash
cat notice.md | npm run send:channel -- --channel 1487823042121040036 --stdin
npm run send:channel -- --channel 1487823042121040036 --content "hello" --provider codex
```

Notes:

- By default it reuses the current `.env` Discord token, proxy settings, and `BOT_PROVIDER`
- Use `--provider shared|codex|claude|antigravity|zcode|pi|omp` to choose a specific token group
- Choose exactly one content source: `--content`, `--content-file`, or `--stdin`

## Standalone runtime notes

This repo is a standalone Discord bot for directing Codex CLI and Claude Code from Discord.

- No OpenClaw installation is required
- No plugin installation is required
- Keep it as a **separate Discord app**
- You can still use any process manager you like (`pm2`, `launchd`, Docker, `systemd`, etc.)

## Security

- `dangerous` means **no sandbox**. Codex will run with your user permissions.
- Don’t commit `.env` / session files. `.gitignore` is set up for that.
- If you ever leaked a bot token, **rotate it immediately** in Discord Developer Portal.

## License

MIT
