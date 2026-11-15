#!/bin/sh
# dsh-server entrypoint: boot dsh from the platform-prepared metadata dir —
# DSH_META_DIR carries overlay.yml (composition patch rows, composed by the
# platform backend) plus env.list (dotenv single-quoted); the entrypoint
# sources the env and passes the overlay as the single --patch argument.
# Without a complete metadata dir the invocation boots bare: a platform-less
# direct run must bring its own --patch. The process writes its output to
# /tmp/dsh.log and this script streams the file to stdout, so both
# `docker logs` and `daytona exec -- cat /tmp/dsh.log` see the printed
# authenticated URL; TERM/INT forward to dsh for a graceful stop.
# Any invocation that already carries --patch, or boots another profile, runs
# verbatim.
#
# Trust authorities: the Daytona preview proxy routes by the Host header, so
# /api requests arrive under the preview authority, an opaque per-sandbox
# token not derivable inside the sandbox. The bootstrap writes that authority
# to /data/dsh-trusted-host (after `daytona preview-url`) and restarts the
# sandbox once; DSH_TRUSTED_HOSTS adds deployment-declared authorities the
# same way.
set -u

# dsh 0.2.2 起 webserver 拒绝通配绑定（overlay 亦然），而 docker -p 与
# Daytona 预览代理到不了 loopback：推导主路由源 IP（UDP connect 无发包）
# 注入 DSH_BIND_HOST，元数据 overlay 的 webserver 行在补丁求值时读取。
# 推导失败回落 loopback——web 外部不可达但不误暴露，fail-safe。容器内
DSH_BIND_HOST="${DSH_BIND_HOST:-$(python3 -c "import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(('10.255.255.255', 1))
    print(s.getsockname()[0])
except Exception:
    print('127.0.0.1')
finally:
    s.close()" 2>/dev/null)}"
[ -n "$DSH_BIND_HOST" ] || DSH_BIND_HOST=127.0.0.1
export DSH_BIND_HOST

# Runtimes that clear the image CMD (daytona sandboxes) still boot the web
# profile, the deployment this image exists for.
if [ "$#" -eq 0 ]; then
  set -- --profile web --no-open
fi

run_verbatim() {
  exec dsh "$@"
}

for argument in "$@"; do
  case $argument in
    --patch|--patch=*) run_verbatim "$@" ;;
  esac
done

trusted_flags=""
# The Daytona preview proxy routes by the Host header, and the stable routing
# form is <port>-<sandbox-uuid>.<domain> (port from ALLYBUILD_DSH_PORT,
# default 3080; platform agents listen on arbitrary ports): the sandbox hostname IS the uuid, so
# the authority derives at boot without any provisioning dance (the opaque
# token `daytona preview-url` prints changes on every boot). A uuid-shaped
# hostname gates the derivation to Daytona-like runtimes; /data/dsh-trusted-host
# and DSH_TRUSTED_HOSTS remain for proxies without a derivable authority.
case $(hostname) in
  [0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*)
    _port="${ALLYBUILD_DSH_PORT:-3080}"
    trusted_flags="--trusted-host ${_port}-$(hostname).${DSH_PREVIEW_DOMAIN:-daytonaproxy01.net}"
    ;;
esac
if [ -f /data/dsh-trusted-host ]; then
  while IFS= read -r host; do
    if [ -n "$host" ]; then
      trusted_flags="$trusted_flags --trusted-host $host"
    fi
  done < /data/dsh-trusted-host
fi
if [ -n "${DSH_TRUSTED_HOSTS:-}" ]; then
  for host in $(printf %s "$DSH_TRUSTED_HOSTS" | tr ',' ' '); do
    trusted_flags="$trusted_flags --trusted-host $host"
  done
fi

# Boot metadata bootstrap: the platform pre-writes overlay.yml (docker rows +
# agent rows + MCP insert rows, composed by backend-ts) and env.list (dotenv
# single-quoted) into a metadata dir — DSH_META_DIR points at it (persistent
# sandbox: meta volume subpath; transient: sandbox-local /tmp/dsh-meta). One
# input boots the agent with zero platform runtime dependency. Without a
# complete metadata dir the invocation boots bare (no --patch): a platform-less
# direct run must bring its own --patch.
patch_arg=""
if [ -n "${DSH_META_DIR:-}" ] && [ -f "$DSH_META_DIR/overlay.yml" ]; then
  if [ -f "$DSH_META_DIR/env.list" ]; then
    set -a
    . "$DSH_META_DIR/env.list"
    set +a
  fi
  patch_arg="$DSH_META_DIR/overlay.yml"
else
  echo "dsh-entrypoint: DSH_META_DIR unset or incomplete; booting without a patch overlay" >&2
fi


# Supervise flag stripping must precede active-profile detection: with
# --supervise first the bare case below would classify the invocation as
# profile web and watch the wrong enable marker.
supervising=0
if [ "${1-}" = "--supervise" ]; then
  supervising=1
  shift
fi
case "${1-}" in
  --profile) active_profile="${2-}" ;;
  --profile=*) active_profile="${1#--profile=}" ;;
  web) active_profile="web" ;;
  *) active_profile="web" ;;
esac

if [ "${1-}" = "web" ]; then
  shift
  set -- web "$@"
elif [ "${1-}" = "--profile" ] && [ "${2-}" = "web" ]; then
  shift 2
  set -- --profile web "$@"
elif [ "${1-}" = "--profile=web" ]; then
  shift
  set -- --profile=web "$@"
elif [ "${1-}" = "--profile" ] && [ "${2-}" != "" ] && [ "${2-}" != "web" ]; then
  # Per-agent profile (platform single-port process): the metadata overlay's
  # all-interfaces webserver bind and the integration rows apply to every
  # profile — without it the process binds loopback inside the container and
  # the preview proxy (the only traffic path) cannot reach it.
  profile="$2"
  shift 2
  set -- --profile "$profile" "$@"
fi
if [ -n "$patch_arg" ]; then
  # --patch must precede the profile positional: dsh hands options after the
  # profile name to the booted app (commander passthrough), where --patch is
  # unknown — appending it after "$@" died as "unknown option '--patch'".
  set -- --patch "$patch_arg" "$@"
fi
if [ -n "$trusted_flags" ]; then
  # Word splitting is the point: the value is a flag list this script built.
  # shellcheck disable=SC2086
  set -- "$@" $trusted_flags
fi

# The AllyBuild plugin packages ride in the source tree without dependents, so
# the profile resolution generation never links them; the profile patch rows
# import them by name from the profile directory. Each package resolves its
# own workspace peers from its pnpm-linked node_modules, so one symlink per
# package is the whole installation. The booting profile's own node_modules
# is what its rows import through — the platform's per-agent profiles are
# materialized as profiles/<agent-id>, so link for whichever profile this
# invocation runs (defaulting to web) instead of hardcoding web.
profile_modules="${DSH_HOME:-/data}/profiles/${active_profile:-web}/node_modules/@deepseek-ai"
mkdir -p "$profile_modules"
for plugin in session-sync progress-sync answerer; do
  ln -sfn "/dsh/packages/plugins/$plugin" "$profile_modules/dsh-allybuild-$plugin"
done
# The minimal-surface bundle row resolves through the same profile node_modules.
ln -sfn /dsh/web-minimal "${profile_modules%/\@deepseek-ai}/dsh-web-minimal"

# Supervise mode (--supervise must be the first argument): respawn the dsh
# process while the platform's enable marker exists. The platform writes
# /data/agent-runtime/<profile>.enabled right before launching this script
# (env — port, DSH_HOME, credentials — arrives via the exec environment and
# is inherited by every respawn) and removes the marker when it stops the
# gateway on purpose (idle policy / manual stop), at which point this loop
# exits instead of fighting the platform.
if [ "$supervising" = 1 ]; then
  # --supervise was already stripped above; $@ is the full dsh invocation.
  rt_dir=/data/agent-runtime
  enabled_marker="$rt_dir/${active_profile}.enabled"
  sup_log="${DSH_HOME:-/data}/dsh-supervise.log"
  echo "supervise: watching profile ${active_profile} (marker ${enabled_marker})" >> "$sup_log"
  while :; do
    if [ ! -f "$enabled_marker" ]; then
      echo "supervise: enable marker removed — exiting" >> "$sup_log"
      exit 0
    fi
    dsh "$@" >> "$sup_log" 2>&1
    echo "supervise: dsh exited ($?) — respawning in 2s" >> "$sup_log"
    sleep 2
  done
fi

: > /tmp/dsh.log
tail -f -n +1 /tmp/dsh.log &
tail_pid=$!
dsh "$@" > /tmp/dsh.log 2>&1 &
dsh_pid=$!
trap 'kill -TERM "$dsh_pid" "$tail_pid" 2>/dev/null' TERM INT
wait "$dsh_pid"
status=$?
kill "$tail_pid" 2>/dev/null
exit "$status"
