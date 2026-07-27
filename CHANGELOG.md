# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Added platform Adapter/Foundation contracts, capability policies, normalized inbound event models, platform-neutral command views, delivery ports, conversation services, and their Discord implementations.
- Added a reusable platform Adapter conformance suite covering messages, commands, cancellation, attachments, capability degradation, child conversations, and error recovery.
- Added a synthetic Foundation core smoke test that composes the real AppContext without Discord SDK objects.
- Added a Feishu/Lark message-first Adapter using the official Node SDK and WebSocket transport, including group mentions, DMs, text commands, reply-chain session keys, message edits, notifications, attachment resource downloads, access policy, and lifecycle recovery.
- Added an optional `lark-cli` transport that reuses encrypted persistent CLI credentials for event streaming, sends, replies, progress edits, and resource downloads without copying the App Secret into the project environment.
- Added an optional Lark webhook transport using the official dispatcher, with verification-token and signature checks, encrypted-event decryption, URL challenges, a fixed POST path, generic rejection responses, and request-size limits.
- Added a separate non-sensitive GET health endpoint for the Lark webhook transport, with callback/health path collision validation.
- Added bounded Lark webhook header, complete-request, and idle keep-alive timeouts to prevent slow clients from occupying listener sockets indefinitely.
- Added bounded Lark message, card-action, and bot-menu event deduplication across SDK, CLI, and webhook delivery paths to prevent retried events from executing twice.
- Added native Lark interactive cards for shared Settings, Onboarding, Workspace, conflict, and retry flows, with button/select action routing and in-place card updates on SDK, CLI, and webhook transports.
- Added Card 2.0 form equivalents for shared modal views, including model, Codex profile, and compact-threshold input with in-place open and validation updates on all supported Lark transports.
- Added native Lark custom bot-menu command entry through `application.bot.menu_v6`, resolving the operator's direct chat and routing menu event keys through the shared command router on SDK, CLI, and webhook transports.
- Extended the read-only Lark readiness check to audit the published bot version, delivery mode, required published events, and bot-menu configuration while keeping callback subscriptions and isolated-chat smoke tests as explicit manual checks when the application API cannot prove them.
- Made Lark readiness compare the published bot menu against the versioned required `event_key` set instead of accepting any enabled non-empty menu.
- Made credential-verified Lark readiness fail on an empty chat/tenant/user allowlist while still completing all available read-only remote checks.
- Made required native Lark slash-command registry verification fail closed when the read-only list API is unavailable.
- Added native Lark app slash-command support: provider-prefixed command manifests, ordinary-message routing into the shared text-command core, a secret-free registry drift audit, and an explicit additive `sync:lark-commands -- --apply` provisioning path that never deletes extra commands.
- Added private equivalents for non-form Lark `ephemeral` interaction responses: group-card results are delivered to the operator's bot DM, retain the source chat/reply-chain session context across restarts, and keep subsequent card updates private.
- Added `npm run check:lark`, a secret-free deployment preflight that shares production configuration parsing, validates local SDK/CLI availability, and can optionally verify CLI or SDK credentials, bot identity, and the versioned tenant-scope baseline without starting consumers or sending messages.
- Added an explicit-write `smoke:lark-dm` driver: the default is a no-message preflight, while `--apply` verifies ordinary private prompts, parameterized native commands, and unknown slash-path fallback without exposing identifiers, credentials, or message bodies.
- Added an explicit-write `smoke:lark-denial` driver: the default is a no-message identity preflight, while `--apply` synthesizes an unauthorized shared-card action, sends and reads back one real private bot denial, and asserts zero shared-card updates and zero extra event consumers without exposing identifiers or message bodies.
- Added `smoke:lark-denial-live` for the real second-user acceptance: its read-only preflight discovers the single active runtime/group, member count, and owner-only allowlist; explicit preparation writes one shared card only with at least two users, reuses the production consumer, records a boolean-only private-delivery receipt, and verifies that the shared-card hash stayed unchanged.
- Added exact `--group-name` selection to `smoke:lark-denial-live`, allowing a newly created bot-accessible isolation group to be tested before it has produced local session state without printing or persisting its name or ID.
- Added an explicit-write `smoke:lark-webhook-edge` driver: the default is a local dependency preflight, while `--apply` uses a temporary public TLS tunnel and synthetic random secrets to verify encrypted challenges/events, invalid-signature rejection, and listener restart recovery without changing the Lark app configuration.
- Added `smoke:lark-webhook-live` for real production Open Platform acceptance: read-only preflight requires the single active webhook runtime, encryption, a matching public HTTPS callback URL, and local/public health; explicit preparation records only verified request, successfully handled message/slash/menu/card-event, application-restart, and reverse-proxy-recovery booleans without starting another consumer.
- Added Lark task-status reactions through the shared message-delivery status port.
- Added Lark group reply-chain child conversations for shared Codex/Claude fork and Codex side flows, including stable `root_id` session keys, root-message rename/cleanup markers, recent-output replay, failure compensation, and card-action context restoration.
- Added platform-neutral health snapshots and Lark SDK/CLI/webhook connection, retry, self-heal, and message-delivery metrics to shared status reports.
- Added `BOT_PLATFORM`, `BOT_INSTANCE_ID`, Lark configuration, platform-and-instance state isolation, and `start:lark` / `dev:lark` / `test:lark` scripts.
- Added privacy-safe Lark card diagnostics that log only normalized action kind, component prefix/length, workspace-browser state booleans, and response completion booleans without recording component payloads, identifiers, or message bodies.

### Changed

- Routed command UI, message and interaction input, runtime delivery, project-upgrade notifications, fork/side conversation lifecycle, presentation, and conversation security through platform-neutral boundaries.
- Composed the existing Discord runtime through one platform Foundation while preserving Discord command registration, session keys, persisted data, configuration, startup modes, and user-visible behavior.
- Updated the multi-platform plan and deployment checklist for native Lark cards/forms, slash commands, group reply-chain child conversations, verified webhook deployment, and the remaining real-credential smoke work; Slack remains a later phase.
- Reclassified the Lark milestone as functionally complete and in production acceptance, added a dated capability/verification checkpoint, and prioritized the remaining roadmap as Lark smoke/release, unified observability, Discord conversation-key migration tooling, then Slack.
- Made AppContext require an explicit Foundation, leaving Discord Foundation construction only in the startup composition root.
- Made normalized inbound actor, conversation, attachments, reply references, and history metadata the only core message contract.
- Kept Discord's legacy default filenames unchanged while namespacing Lark session data, locks, project-upgrade state, and heartbeat identifiers by platform and instance.
- Accepted Node.js 18 for the Lark implementation; any future Slack runtime upgrade remains a separate decision.
- Changed successful Lark Card 2.0 form completion to keep the submitted form as a Card 2.0 saved acknowledgement and send the refreshed Card 1.0 Settings panel as a new message, avoiding an unsupported in-place schema downgrade.
- Changed non-form `ephemeral` responses from an existing private Lark card to update that private card in place, including after a process restart when only the embedded source-conversation context remains.
- Kept live Lark denial receipts local and instance-isolated with mode `0600`; they retain the prepared shared-card correlation needed for verification but never store the denied actor or private message/chat identifiers.
- Kept live Lark webhook receipts local, provider/instance-isolated, and mode `0600`; they store no public URL, signature, decrypted body, or app/user/chat/message/event identifier, and synthetic edge requests are not reported as production acceptance.

### Removed

- Removed the unused slash command surface facade and its tests.
- Removed raw Discord message accessor fallback, the conversation history `author` alias, and legacy `childThread`, `discordCleanup`, and `discordArchive` result aliases.

### Fixed

- Let the Lark lifecycle own SIGTERM/SIGINT through completion instead of allowing the single-instance lock handler to exit first; active work cancellation, transport disconnect, completion logging, and lock cleanup now finish in order.
- Made graceful Lark shutdown await every active provider child process through SIGTERM and bounded SIGKILL escalation, preventing stubborn tasks from surviving as orphan processes after the bot exits.
- Decoupled Lark graceful SIGTERM/SIGINT shutdown from the self-heal toggle, cancelled pending retries during exit, and prevented disconnect failures or queued recovery timers from restarting a terminating process.
- Made Lark native slash-command provisioning verify its read/write scopes, use explicit create/update operations, support a no-write whole-plan `--dry-run`, and reject missing permissions, capacity, or request-validation failures before any writes.
- Kept Codex goal completion/blocker grace timers referenced until the runner settles, preventing pending executor tests or lightweight process wrappers from being cancelled while awaiting the scheduled stop.
- Allowed native image staging to use platform-provided attachment downloaders, so private Lark image resources can reach Codex without a public HTTP URL.
- Prevented Lark app/bot-authored messages from entering the prompt loop and made fatal Lark credential/format failures stop instead of retrying forever.
- Allowed user-bound command, Settings, Onboarding, Workspace, conflict, and retry component IDs to accept Lark `ou_...` open IDs instead of only Discord numeric IDs.
- Prevented private Lark interaction context from accepting malformed, cross-platform, or tenant/chat/root-conflicting values, and prevented permission denials from replacing shared group cards.
- Made Lark startup reject placeholder credentials and invalid selected-transport domain/path/numeric settings instead of silently falling back, while applying the configured text chunk limit through the platform delivery port.
- Corrected the Lark permission baseline to cover group-at/DM receive, bot send, message update/recall, resource access, and reaction read/write operations actually used by the adapter.
- Sent Lark fork/side reply-chain roots as content-only native cards and preserved their card target metadata during rename/archive, so side close can update the existing root in place instead of failing with `This message is NOT a card.`
- Treated Lark message-history error `230027 / user_unauthorized` as an unavailable optional fork replay instead of showing a misleading user reauthorization warning after the native fork already succeeded; unexpected history failures remain visible.
- Kept proxy auto-repair runtime-only by default, so temporary systemd/shell outage proxies can fill equivalent process environment keys without being persisted into `.env` and silently trapping future Lark consumers on a stopped local proxy.
- Treated null or empty `option` fields emitted by `lark-cli` button callbacks as buttons instead of selects, restoring Onboarding and Workspace Browser actions on the CLI transport.
- Kept expired Workspace Browser responses visible in the original private card after restart instead of relying on an associated reply that could be hidden from the main P2P message list.
- Removed full component, user, and conversation identifiers from handled Lark card and bot-menu diagnostics; handled and unhandled controls now share the same bounded component prefix/length logging shape, while menus log only a sanitized command token.
- Based live denial card verification on an immediate bot-API readback after send, so Lark's server-side card-schema normalization is part of the baseline instead of being misreported as a mutation caused by the second-user click.

### Verified

- Added and ran focused contract, boundary, Discord Adapter, input, presentation, security, notification, conformance, synthetic smoke, and AppContext regressions for the platform abstraction work.
- Added Lark foundation, conformance, inbound, delivery, security, lifecycle, entry-handler, reply-chain fork/side, webhook dispatcher, official-SDK Node.js 18 smoke, and platform-instance isolation coverage.
- Provisioned the four merged Pi/OMP session aliases after a complete dry-run and read-only reverified the 46-command native Lark registry; provisioning scopes are 2/2, missing/outdated/extra are all zero, and 54 of 100 command slots remain available.
- Passed credential-verified Lark deployment readiness with tenant scopes 9/9, events 2/2, card callbacks 1/1, bot-menu event keys 7/7, a restrictive app-scoped user allowlist, and a real P2P `!status` receive/reply round trip.
- Verified real P2P Settings card rendering and in-place updates, select and Card 2.0 form callbacks, bot-menu command events, native `/cx_status` routing with an associated reply, and the invalid-profile form validation path.
- Verified the explicit-write P2P smoke driver end to end for an ordinary prompt, a parameterized native command, and unknown slash-path prompt fallback.
- Verified an isolated group mention-only flow with no response to an unmentioned message and an associated response after mentioning the bot; a generated image was downloaded and understood through native image input; a real workspace-lock wait was cancelled with `THINKING` transitioning to the valid `No` reaction.
- Verified real Lark fork and Codex side reply chains with independent session bindings and in-chain replies. After the content-only root-card fix, a newly opened side closed by updating the same interactive root message in place to `🔒 Codex side conversation closed`, with both parent and child session metadata persisted as closed.
- Verified a new real Lark fork after the history-access fallback: the interactive root and fork session were created, the success report remained associated with that root, and no latest-output replay authorization warning was emitted.
- Verified real CLI-transport SIGTERM with `SELF_HEAL_ENABLED=false` for both an idle instance and a controlled active task registered through the production channel runtime. The active child deliberately ignored SIGTERM, was removed by bounded SIGKILL escalation before parent exit, all three event consumers stopped, the instance lock was released, and the supervised single consumer reconnected after restoration.
- Verified real CLI consumer-loss recovery by terminating the message-event consumer: the lifecycle recorded `channel_error`, self-healed without replacing the main process, restored all three direct consumers, and returned to exactly six wrapper/worker consumer processes without duplicates.
- Verified a controlled real CLI network outage through a switchable local CONNECT proxy: the same main process and 3/3 consumers entered reconnecting, recovered with a reconnected event, and continued receiving group commands. The next `!status` showed retries increasing from 0 to 1, self-heal restarts remaining 0, delivery counts of 1 succeeded / 2 failed / 0 in flight, and a credential-free latest failure.
- Re-ran the isolated group image and cancellation paths after transport recovery: a generated three-band image was exposed as a native resource and answered in red/green/blue order; a controlled task reached `THINKING`, then `!cancel` replaced it with `No` while the main PID remained unchanged. The persisted reply-chain audit still returns four chains, two fork bindings, two closed side records, and one directly readable locked native side root.
- Re-ran the merged checkpoint with `npm run test:lark` at 116/116 and the expanded shared `test:progress` suite at 838/838; earlier Foundation/conformance and platform input/security/presentation/topology checkpoints remain recorded at 14/14, 14/14, and 201/25/196/54. Credential-verified readiness, syntax checks, safe-reply checks, and `git diff --check` also passed; at that checkpoint the deployment checklist isolated successful form, private permission/restart, and public-webhook smoke as the remaining work.
- Verified a real compact-threshold form save and reset-to-default flow: the submitted Card 2.0 form showed a saved acknowledgement, a fresh Settings card exposed the latest controls, and the persisted override was subsequently cleared.
- Verified Onboarding-to-Workspace-Browser private navigation on the CLI transport, including correct button classification and restoration of the source group/reply-chain context.
- Verified the private Workspace Browser restart boundary with an actual process replacement: the stale control updated the original private card to an expired state with zero remaining actions, produced zero new group messages, and preserved the workspace, runner-session, Codex-thread, and provider bindings.
- Re-ran the completed checkpoint with `npm run test:lark` at 120/120 and `npm run test:progress` at 844/844; both suites passed with zero failures, cancellations, or skips.
- Verified the temporary public webhook edge through real HTTPS: the health probe, encrypted URL challenge, signed/encrypted dispatcher event, generic invalid-signature rejection, and same-tunnel listener restart recovery all passed. This does not replace the remaining real Open Platform webhook acceptance.
- Verified the credentialed synthetic private-denial rehearsal with one real bot DM read back successfully, zero shared-card updates, and zero extra event consumers. This does not replace the remaining second-user click on a real shared card.
- Re-ran the expanded checkpoint with `npm run test:lark` at 123/123 and `npm run test:progress` at 847/847; credential-verified readiness and the no-tunnel webhook edge preflight also passed.
- Re-ran the private-denial checkpoint with `npm run test:lark` at 127/127 and `npm run test:progress` at 851/851; credential-verified readiness remained at scopes 9/9, events 2/2, callbacks 1/1, menu keys 7/7, and native slash commands 46/46.
- Ran the live private-denial preflight against the active production CLI runtime: one accessible group and the owner-only allowlist were found, but the group currently contains only one user, so preparation correctly sent no card and created no acceptance state.
- Re-ran the live-denial checkpoint with `npm run test:lark` at 139/139 and `npm run test:progress` at 863/863; both suites completed with zero failures, cancellations, or skips.
- Ran the live webhook preflight against the active production CLI runtime: it rejected the non-webhook transport before any network probe or acceptance-state write, so the still-missing production secrets/callback cannot be mistaken for completed acceptance.
- Re-ran the webhook-live checkpoint with `npm run test:lark` at 149/149 and `npm run test:progress` at 873/873; both suites completed with zero failures, cancellations, or skips.
- Ran the first real second-user click in a new two-user isolation group: the production card consumer received the action and entered the private-denial branch with the owner-only allowlist and 3/3 consumers intact, but Lark rejected the bot DM with `230013` because the second tester was outside the app availability scope. At that point, the receipt remained unverified pending the external scope correction and retry.
- Re-ran the same real second-user card after publishing the expanded app availability scope and opening the bot P2P chat once: the production consumer observed the callback, the denied actor differed from the owner, the private delivery succeeded in a chat separate from the group, and the server-normalized shared-card hash stayed unchanged.
- Re-ran the final code checkpoint with `npm run test:lark` at 150/150 and `npm run test:progress` at 874/874; failures, cancellations, and skips remained zero.

## [0.14.0] - 2026-07-25

### Added
- Added Pi Agent and Oh My Pi as shared or dedicated providers, covering CLI argument building, event parsing, session resume and compaction, status and permission-mode labels, slash prefixes, settings and onboarding entries, launch scripts, and service restart support.
- Added Claude model discovery from local `settings.json`, including `ANTHROPIC_DEFAULT_*_MODEL` overrides and the fable tier, so configured models appear in the model menu.
- Added `--nonce` to the channel message script so a retried send is deduplicated by Discord instead of posting twice.

### Changed
- Kept tool and command activity out of the streamed process narration, so tool-heavy runs no longer bury what the agent says about its own progress. Tool progress stays visible on the latest-activity line and in completed milestones.
- Gave agent narration priority over mechanical tool labels on the latest-activity line, with errors still taking precedence over both.
- Showed the model observed in Claude runtime events on the progress card instead of reporting an unknown model when no default is configured.

### Fixed
- Fixed Claude CLI help parsing that truncated multi-line `--model` and `--effort` option blocks to their first line.
- Forwarded native Codex progress events and restored Codex process commentary.

## [0.13.0] - 2026-07-21

### Added
- Added ZCode CLI as a shared or dedicated provider, with headless JSON execution, file attachments, workspace-bound session resume, recent-session discovery, provider-scoped configuration, and service restart support.
- Added ZCode provider choices, status text, onboarding, slash aliases, and focused regression coverage across runtime, settings, sessions, and runner behavior.

### Changed
- Reworked model selection into catalog-backed Discord controls that reject unsupported model and reasoning-effort combinations and expire stale panels.
- Improved live progress so current Codex command, file, search, tool, warning, and failure events are readable without repeating streamed process text in the final reply.

### Fixed
- Stopped malformed or empty successful ZCode output from being reported as a successful run.
- Stopped retries when a bound Claude session no longer exists, preserving the original failure instead of repeating it.

## [0.12.23] - 2026-06-08

### Added
- Added the get the 10 nine-grid asset pipeline, real mixed-aspect image2 trial assets, and additional world-render prompt trial packs for city morning and arrogance directions.
- Added a local get the 10 live server that serves the prototype and exposes `/api/runs` for first-round real image generation.

### Changed
- Updated the get the 10 prototype so the first round can show live generation progress, crop remote nine-grid outputs into selectable candidates, and start from a smaller feedback-ready live run.
- Allowed cancelling the main first-round selection.

### Verified
- Recorded dense, Cohub fill, and real-asset verification screenshots for the get the 10 prototype.

## [0.12.21] - 2026-05-20

### Added
- Added Antigravity CLI provider support with canonical `antigravity` naming, `agy` launch support, settings-backed model updates, and documented reasoning-model choices in the model menu.

### Changed
- Kept `/goal` as one slash command with action choices while opening required modals for `set` and `budget` inputs.

### Removed
- Removed Gemini CLI provider compatibility, including `gemini`/`google` provider aliases, `gm` startup paths, `GEMINI__*` environment fallbacks, legacy session readers, and the old provider shim.

## [0.12.11] - 2026-05-05

### Fixed
- Fell back to channel sends when Discord interaction webhook tokens expire, so delayed replies such as goal completion notices are still delivered.

## [0.12.10] - 2026-05-04

### Changed
- Hardened project upgrades with temporary-worktree validation before touching the main checkout, cached status checks, admin-only apply/mode commands, cross-bot heartbeat idle checks, and `all` as the default restart target.
- Reworked `/goal` into action-specific subcommands so `set` requires an objective and non-text actions no longer expose irrelevant free-text inputs.

### Fixed
- Stopped completed Codex goal continuations from leaving Discord progress cards running when `codex exec` does not exit after SIGTERM.

## [0.12.9] - 2026-05-04

### Added
- Added project upgrade checks for agents-in-discord itself, including `/upgrade`, `!upgrade`, `/status` visibility, notify-by-default mode, and optional safe auto-upgrade.
- Added a project upgrade CLI that refuses dirty, diverged, or non-fast-forward updates and runs verification before requesting a restart.

## [0.12.8] - 2026-05-04

### Fixed
- Stopped Codex goal continuation runs when the official goal state becomes complete, so Discord progress cards finish instead of waiting for a hung `codex exec` process.

## [0.12.7] - 2026-05-04

### Added
- Added fork-origin notices in new Discord fork threads that mention the requester and identify the parent session.
- Added a runtime and busy-prompt modes spec plus channel settings/status output for effective queue-vs-steer behavior.

### Changed
- Runtime settings now use cache-safe `exec` wording and keep busy prompts fail-closed to queue unless a real long-runtime steer path is available.

## [0.12.6] - 2026-05-03

### Added
- Added Claude Code fork support that mirrors Codex fork in Discord while using `--fork-session` on the first child-thread turn.

## [0.12.5] - 2026-05-03

### Changed
- Simplified Codex fork input to one optional Discord thread name; leaving it blank keeps generated fork naming.

## [0.12.4] - 2026-05-03

### Changed
- Made Discord extra info cache-first by removing per-message IDs from the default template and keeping `{msg}` templates out of provider system-prompt layers.

## [0.12.3] - 2026-05-03

### Added
- Added configurable Discord extra info for agent prompts, with status reporting, token estimates, slash/text commands, inheritance, and environment defaults.

### Changed
- Sends Discord extra info through provider system-prompt channels where supported, matching Hermes-style context injection for Codex and normal Claude runs.
- Keeps `/status` compact by showing extra info state and token cost without rendering the full resolved text.

### Fixed
- Preserved compatible per-turn extra info delivery for Antigravity and Claude long-runtime sessions when no dynamic system-prompt channel is available.

## [0.12.2] - 2026-05-01

### Fixed
- Aligned Discord Codex goal behavior with official Codex CLI semantics: active goals now enqueue continuation work instead of only saving state.
- Enabled the Codex `goals` feature for normal Codex runner invocations so resumed runs can use native goal runtime behavior.
- Updated goal status text to explain active, paused, budget-limited, and complete states without implying that active is inert.

## [0.12.1] - 2026-05-01

### Changed
- Clarified that Codex goal set/resume operations only update the persisted goal state and do not start a task by themselves.
- Added the current Codex goal, goal query failures, and no-session state to `/status` and `!status`.

## [0.12.0] - 2026-05-01

### Added
- Added native Codex goal controls through `/goal` and `!goal`, backed by Codex app-server `thread/goal/*` APIs with support for status, set, pause, resume, complete, clear, and token budget updates.
- Added Codex app-server client helpers for native thread fork and persisted goal operations.
- Added native Codex image attachment support so Discord image inputs are passed to `codex exec` as CLI image arguments.
- Added compact model/settings controls, including CLI-backed Codex and Claude model catalogs, effort controls, compact threshold editing, and reply delivery settings.
- Added Codex account identity and live rate-limit details to status output.
- Added external signal material pool planning documents under `test-results/`.

### Changed
- Simplified the README and expanded the Codex surface roadmap around native command surfaces.
- Improved Codex permission/profile handling, compact reporting, runtime labels, and provider-scoped configuration surfaces.

### Fixed
- Surfaced Claude API retry errors in Discord instead of hiding them behind generic result handling.
- Covered Codex fork, goal, native image, model panel, compact, provider runtime, and settings flows with regression tests.

## [0.11.4] - 2026-04-16

### Added
- Added Claude long-runner lifecycle logging for spawn, reuse, result, idle close, process close, and turn start events.

### Fixed
- Workspace locks now clean up partial files if writing the lock body fails, archive stale malformed locks before retrying, and record acquisition time when the lock is actually acquired.

## [0.10.2] - 2026-03-31

### Fixed
- Codex Fast mode now follows the effective Discord setting in non-interactive `codex exec` runs even when the result is off, by explicitly passing `features.fast_mode=false` instead of relying on the CLI default.
- Fast mode status text now explains that both off states and inherited channel overrides are forwarded to match Codex `/fast`.

## [0.10.0] - 2026-03-25

### Added
- Added a dedicated Codex defaults section in `/settings` so global model, reasoning effort, and Fast mode can be edited directly in `~/.codex/config.toml`.
- Resume/bind flows for workspace-bound providers now resolve the session's real workspace from provider state, switch the channel to that workspace, and clear duplicate bindings in other threads.

### Changed
- Codex status, settings, and runtime surfaces now distinguish true `config.toml` overrides from provider defaults, and the status report labels token usage as the previous run's input instead of the current live context size.
- Native compact messaging is now fact-based: the bot only discloses compact-related notices when a session id actually switches, including retry paths that continue on the new session automatically.

### Fixed
- Binding a Codex or Antigravity session whose workspace no longer exists now fails explicitly instead of silently keeping a broken session binding.

## [0.9.5] - 2026-03-24

### Fixed
- Restored Codex native compact to keep working as a provider-native compact plus automatic continue flow instead of stopping for a manual follow-up command.
- Native compact replies and compact help text now explicitly disclose that the run keeps going automatically and that any rollout session switch will be shown in the bot reply.
- When a native compact retry rolls to a new rollout session, later retries now stay on that new session instead of silently drifting again.

## [0.9.4] - 2026-03-24

### Fixed
- Stopped failed and successful Codex runs from silently taking over a new rollout session; the pinned session now stays unchanged unless users explicitly resume another session.
- Suppressed Codex native compact handoff for already-bound sessions so crossing the compact threshold no longer triggers an implicit session switch behind the scenes.
- Replies now explicitly disclose any unexpected new session ID instead of hiding it.

## [0.9.3] - 2026-03-22

### Fixed
- Auto retry now keeps the current Codex rollout session instead of silently resetting it before the next attempt, so drawing and other session-sensitive work can continue in the same context.
- Resuming a Codex or Antigravity session now reattaches the thread to the session's original workspace and clears duplicate cross-thread bindings, preventing stale session IDs from reviving in the wrong thread.

## [0.9.2] - 2026-03-17

### Changed
- Codex Fast mode now defaults to on when `~/.codex/config.toml` is missing or does not explicitly set `[features].fast_mode = false`, while preserving thread-level and parent-channel overrides.
- Updated help, settings, and documentation text to explain that "follow global" now inherits the config value and stays on unless explicitly disabled.

## [0.9.1] - 2026-03-17

### Fixed
- Restored the progress-card hint to the intended minimal `!c` wording instead of showing legacy cancel aliases and extra command noise.
- Added the effective Fast mode state to the running progress/status message flow so thread conversations can see whether Fast mode is on and where it is inherited from.

## [0.9.0] - 2026-03-17

### Added
- Thread sessions can now inherit parent-channel defaults for provider-scoped runtime knobs such as model, reasoning effort, Fast mode, and compact settings while still allowing thread-local overrides.

### Changed
- Workspace resolution for threads now prefers an explicit thread override, then the parent channel workspace, then the provider default workspace, and finally the legacy fallback.
- Settings, status, and runtime execution now consistently surface when a thread is inheriting effective values from its parent channel instead of only from global defaults.

## [0.8.1] - 2026-03-16

### Changed
- Simplified queue and progress card hints so user-facing messaging now points to `!c` and `/status` only, while keeping legacy cancel aliases available for compatibility.

## [0.8.0] - 2026-03-16

### Added
- Added `/settings`, an interactive per-channel settings panel that groups provider, model, fast mode, reasoning effort, compact strategy, execution mode, language, and workspace controls behind one slash entry point.

### Changed
- Reframed Fast mode and model tuning around the new settings panel so users can choose explicit options such as "follow global" or open a model modal instead of guessing command-only defaults.

## [0.7.0] - 2026-03-16

### Added
- Added channel-scoped Codex Fast mode controls via `/fast` and `!fast`, with `on|off|status|default` actions and fallback to `~/.codex/config.toml` when no thread override is set.

### Changed
- Status, doctor, and help output now surface whether Codex Fast mode is inherited from config or overridden for the current channel.

## [0.6.2] - 2026-03-16

### Changed
- Reworked `/onboarding` into an ordinary-user first-run guide focused on language, provider, workspace, and the first task instead of admin-oriented security and timeout setup.
- The onboarding workspace step can now open the existing workspace browser directly, and the text fallback now mirrors the same user-facing quick-start flow.
- Slash command replies no longer attach the generic shortcut button bar; users rely on explicit commands while buttons stay reserved for finite-choice flows such as guided setup.

## [0.6.1] - 2026-03-16

### Added
- Added `!c` as a short text-command alias for `cancel`.

### Changed
- Queue, onboarding, help, and live progress messaging now point users to `!cancel` / `!c` while keeping `/abort`, `!abort`, and `!stop` compatibility.
- Running progress cards no longer attach an inline Cancel button and instead stay text-only with explicit command hints.

## [0.6.0] - 2026-03-15

### Added
- Provider-native runtime surface metadata for Codex, Claude, and Antigravity, including session vocabulary, compact capabilities, reasoning-effort support, and runtime-store descriptions.
- Provider-specific session aliases and help surfaces such as `rollout_sessions` / `project_sessions` / `chat_sessions` and matching `resume` aliases.
- Provider-scoped session persistence buckets so model, effort, compact config, raw config overrides, and bound session IDs survive provider switches instead of clobbering each other.
- macOS `launchctl` guard + safe restart helper for protected bot services, with regression coverage for blocked and rewritten service operations.

### Changed
- Compact defaults now prefer provider-native compaction where supported, and status/help/doctor output now explains which compact knobs are actually available on the active provider.
- Session, workspace, and resume messaging now uses provider-native terminology such as rollout session, project session, and chat session.
- README, English README, and `.env.example` now document provider-specific aliases, access controls, runtime behavior, and safer local service operations.

### Fixed
- Retried Discord interaction reply/edit/follow-up/defer flows to reduce transient network failures and interaction timeout regressions.
- Stopped Claude assistant snapshots and structured stream deltas from leaking into the public progress card as fake "process content".
- Final progress cards now end in a stable `done` phase with a clearer terminal latest-step message.

## [0.5.0] - 2026-03-14

### Added
- Antigravity CLI provider support, including dedicated bot mode, provider-aware CLI health checks, and provider-specific session/runtime handling.
- Workspace browser flows for selecting directories from Discord, plus recent/favorite workspace navigation helpers.
- Dedicated startup paths for shared, Codex, Claude, and Antigravity bot instances with provider-scoped env overrides.

### Changed
- Refactored the runtime into smaller modules for app composition, orchestrator/progress/reporting, Discord lifecycle/entry handlers, and provider/runtime helpers.
- Renamed the project and operational surfaces from `Codex-ClaudeCode-in-Discord` to `agents-in-discord`, including package metadata, repo/docs references, and local service labels/scripts.
- Auto-upgrade scripts and local launchd/task-scheduler defaults now use the new `agents-in-discord` naming.

### Fixed
- Claude final answers now render correctly in Discord instead of falling back to "no visible text", and final-answer payloads no longer pollute progress "process content".
- Restored the missing slash registration import in the index bootstrap path.

## [0.3.1] - 2026-03-07

### Added
- Provider-level default workspace support via `DEFAULT_WORKSPACE_DIR`, `CODEX__DEFAULT_WORKSPACE_DIR`, and `CLAUDE__DEFAULT_WORKSPACE_DIR`.
- Runtime workspace controls for both text and slash commands: `!setdir`, `!setdefaultdir`, `/setdir`, and `/setdefaultdir`.
- Cross-process workspace serialization using lock files, so the same workspace is no longer executed concurrently from multiple channels/bots.
- Regression tests for workspace resolution, provider default migration, and workspace lock behavior.

### Changed
- Workspace resolution now prefers thread override → provider default → legacy `WORKSPACE_ROOT/<threadId>` fallback.
- Claude runs now receive the provider default workspace as an extra `--add-dir` when different from the current working directory, making parent/sibling navigation less restrictive.
- Status/help/doctor output now shows effective workspace, workspace source, and serialization state.
- `WORKSPACE_ROOT` is now documented as a legacy fallback root rather than the primary recommended workspace model.

### Fixed
- Stop auto-creating or auto-initializing Git repositories when the effective workspace is an existing shared directory such as `~/GitHub`.
- Keep Claude sessions when switching workspace where possible, while still resetting Codex sessions when a real workspace change makes resume unsafe.
- Allow cancellation while a task is blocked waiting on a busy workspace lock.

## [0.3.0] - 2026-03-07

### Added
- Shared and dedicated startup flows for Discord bot instances via `npm run start:shared`, `npm run start:codex`, and `npm run start:claude`.
- Provider-scoped single-file `.env` loading with `CODEX__*` and `CLAUDE__*` sections plus new utility coverage for provider/env resolution.
- Provider-aware state isolation for locked bot instances, including per-provider session/lock files and default slash prefixes.

### Changed
- Expanded the standalone Discord bot from Codex-only wording to first-class Codex + Claude support across docs, config examples, and runtime helpers.
- Progress/event parsing now understands additional assistant and stream event shapes used by Claude-style runtimes.

### Fixed
- Prefer provider-scoped Discord token and runtime overrides without clobbering higher-priority shell environment values.
- Preserve progress milestones from tool-style response items that omit explicit completion status.

## [0.2.3] - 2026-03-04

### Changed
- `splitForDiscord` now performs markdown-aware chunking and keeps fenced code blocks balanced across message parts.
- Extracted Discord output chunking into `src/discord-message-splitter.js` for isolated testing and safer iteration.

### Fixed
- Avoid splitting inside fenced blocks without reopening/closing markers, preventing broken rendering in long final answers.
- Added regression tests for long plain text, fenced code block chunking, and unclosed-fence auto-healing.

## [0.2.2] - 2026-03-04

### Fixed
- Preserve Markdown line breaks, paragraphs, and fenced code blocks when extracting final answer text from Codex events.
- Add regression tests for Markdown structure preservation in `codex-event-utils`.

## [0.2.1] - 2026-03-03

### Added
- Audience-facing progress stream with a fixed process window and commentary capture from Codex events.
- Configurable process window lines command and event dedupe controls.

### Changed
- Progress rendering now uses raw Codex event text and incremental streaming behavior.
- Added semver release automation (`scripts/cut-release.mjs`) and npm release scripts.

### Fixed
- Acknowledge slash interactions earlier to reduce timeout errors.
- Retry transient Discord send/reply failures.
- Fallback to `channel.send` for system messages when direct replies fail.

## [0.2.0] - 2026-03-01

### Added
- Configurable onboarding wizard for language, security profile, and timeout.
- Per-thread slash commands for onboarding and runtime overrides.
- Text commands for onboarding, language, profile, and timeout management.
- Localized onboarding and help output in Chinese and English.

### Changed
- Persist and migrate session-level settings: language, onboarding, security profile, timeout.
- Progress reporting now follows session language for phases, labels, and hints.
- Documentation and `.env.example` updated for new onboarding controls.
