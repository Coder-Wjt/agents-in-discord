#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
UID_VALUE="$(id -u)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

DISCORD_LABEL="com.atou.agents-in-discord"
WECHAT_LABEL="com.atou.agents-in-discord.wechat"

usage() {
  cat <<EOF
usage: $0 <install|start|stop|restart|status|logs|uninstall> [discord|wechat|all]

Examples:
  npm run services:install
  npm run services:status
  npm run services:logs -- wechat
  npm run services:restart -- discord
EOF
}

targets_for() {
  case "${1:-all}" in
    discord) printf '%s\n' discord ;;
    wechat) printf '%s\n' wechat ;;
    all) printf '%s\n' discord wechat ;;
    *)
      printf 'unsupported service target: %s\n' "${1}" >&2
      usage >&2
      exit 64
      ;;
  esac
}

label_for() {
  case "$1" in
    discord) printf '%s\n' "${DISCORD_LABEL}" ;;
    wechat) printf '%s\n' "${WECHAT_LABEL}" ;;
  esac
}

plist_for() {
  printf '%s/%s.plist\n' "${LAUNCH_AGENTS_DIR}" "$(label_for "$1")"
}

service_ref_for() {
  printf 'gui/%s/%s\n' "${UID_VALUE}" "$(label_for "$1")"
}

env_value() {
  local key="$1"
  local env_file="${PROJECT_ROOT}/.env"
  [[ -f "${env_file}" ]] || return 0
  /usr/bin/awk -F= -v key="${key}" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      value = $0
    }
    END {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^"|"$/, "", value)
      print value
    }
  ' "${env_file}"
}

preflight() {
  local target="$1"
  if [[ ! -x "${NODE_BIN}" ]]; then
    printf 'Node.js executable not found: %s\n' "${NODE_BIN}" >&2
    exit 1
  fi
  if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
    printf 'Missing %s/.env. Create it from .env.example first.\n' "${PROJECT_ROOT}" >&2
    exit 1
  fi

  if [[ "${target}" == "discord" ]]; then
    local token
    token="$(env_value CODEX__DISCORD_TOKEN)"
    [[ -n "${token}" ]] || token="$(env_value DISCORD_TOKEN_CODEX)"
    [[ -n "${token}" ]] || token="$(env_value DISCORD_TOKEN)"
    if [[ -z "${token}" ]]; then
      printf 'Discord is not ready: set CODEX__DISCORD_TOKEN in %s/.env\n' "${PROJECT_ROOT}" >&2
      exit 1
    fi
  fi

  if [[ "${target}" == "wechat" && ! -s "${PROJECT_ROOT}/data/wechat/credentials.json" ]]; then
    printf 'WeChat is not ready: run "npm run start:wechat" once and scan the QR code first.\n' >&2
    exit 1
  fi
}

write_plist() {
  local target="$1"
  local label plist stdout_path stderr_path
  label="$(label_for "${target}")"
  plist="$(plist_for "${target}")"
  stdout_path="${PROJECT_ROOT}/logs/${target}.service.log"
  stderr_path="${PROJECT_ROOT}/logs/${target}.service.err.log"

  local -a args
  if [[ "${target}" == "discord" ]]; then
    args=("${NODE_BIN}" "${PROJECT_ROOT}/scripts/start-instance.mjs" codex)
  else
    args=("${NODE_BIN}" "${PROJECT_ROOT}/src/wechat/index.js")
  fi

  {
    cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
EOF
    for arg in "${args[@]}"; do
      printf '      <string>%s</string>\n' "${arg}"
    done
    cat <<EOF
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_ROOT}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${HOME}</string>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${stdout_path}</string>
    <key>StandardErrorPath</key>
    <string>${stderr_path}</string>
  </dict>
</plist>
EOF
  } > "${plist}"

  chmod 600 "${plist}"
  /usr/bin/plutil -lint "${plist}" >/dev/null
}

install_service() {
  local target="$1"
  local plist service_ref
  preflight "${target}"
  plist="$(plist_for "${target}")"
  service_ref="$(service_ref_for "${target}")"
  write_plist "${target}"
  /bin/launchctl bootout "${service_ref}" >/dev/null 2>&1 || true
  /bin/launchctl bootstrap "gui/${UID_VALUE}" "${plist}"
  /bin/launchctl enable "${service_ref}" >/dev/null 2>&1 || true
  /bin/launchctl kickstart -k "${service_ref}"
  printf 'installed and started: %s\n' "${service_ref}"
}

start_service() {
  local target="$1"
  local service_ref plist
  preflight "${target}"
  service_ref="$(service_ref_for "${target}")"
  plist="$(plist_for "${target}")"
  if ! /bin/launchctl print "${service_ref}" >/dev/null 2>&1; then
    [[ -f "${plist}" ]] || {
      printf 'service is not installed: %s\n' "${service_ref}" >&2
      exit 1
    }
    /bin/launchctl bootstrap "gui/${UID_VALUE}" "${plist}"
  fi
  /bin/launchctl kickstart -k "${service_ref}"
  printf 'started: %s\n' "${service_ref}"
}

stop_service() {
  local target="$1"
  local service_ref
  service_ref="$(service_ref_for "${target}")"
  /bin/launchctl bootout "${service_ref}" >/dev/null 2>&1 || true
  printf 'stopped: %s\n' "${service_ref}"
}

status_service() {
  local target="$1"
  local service_ref output
  service_ref="$(service_ref_for "${target}")"
  printf '\n[%s] %s\n' "${target}" "${service_ref}"
  if output="$(/bin/launchctl print "${service_ref}" 2>/dev/null)"; then
    printf '%s\n' "${output}" \
      | /usr/bin/awk '/^[[:space:]]*(state|pid|last exit code) =/ { sub(/^[[:space:]]+/, ""); print }'
  else
    printf 'not loaded\n'
  fi
}

logs_service() {
  local target="$1"
  printf '\n[%s stdout]\n' "${target}"
  /usr/bin/tail -n 80 "${PROJECT_ROOT}/logs/${target}.service.log" 2>/dev/null || true
  printf '\n[%s stderr]\n' "${target}"
  /usr/bin/tail -n 80 "${PROJECT_ROOT}/logs/${target}.service.err.log" 2>/dev/null || true
}

uninstall_service() {
  local target="$1"
  stop_service "${target}"
  rm -f "$(plist_for "${target}")"
  printf 'uninstalled: %s\n' "$(label_for "${target}")"
}

main() {
  local action="${1:-}"
  local selection="${2:-all}"
  [[ -n "${action}" ]] || {
    usage >&2
    exit 64
  }

  mkdir -p "${LAUNCH_AGENTS_DIR}" "${PROJECT_ROOT}/logs"

  local target
  while IFS= read -r target; do
    case "${action}" in
      install) install_service "${target}" ;;
      start) start_service "${target}" ;;
      stop) stop_service "${target}" ;;
      restart)
        stop_service "${target}"
        start_service "${target}"
        ;;
      status) status_service "${target}" ;;
      logs) logs_service "${target}" ;;
      uninstall) uninstall_service "${target}" ;;
      *)
        usage >&2
        exit 64
        ;;
    esac
  done < <(targets_for "${selection}")
}

main "$@"
