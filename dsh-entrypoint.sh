#!/bin/sh
# dsh-server entrypoint: run dsh with the container bind overlay that switches
# the webserver to the all-interfaces literal (docker -p cannot reach a
# loopback bind, and the web profile refuses 0.0.0.0 as a flag). The process
# writes its output to /tmp/dsh.log and this script streams the file to
# stdout, so both `docker logs` and `daytona exec -- cat /tmp/dsh.log` see the
# printed authenticated URL; TERM/INT forward to dsh for a graceful stop.
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

overlay=/usr/local/share/dsh/docker-overlay.yml

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

# Per-agent overlay channel: the patch dsh boots with is always the container
# base rows (docker-overlay.yml — the all-interfaces webserver bind) followed
# by the baked agent overlay rows (agent-overlay.yml, the AllyBuild
# gateway-routing layer; row concatenation IS the merge — see merge-overlay.py).
# When DSH_AGENT_OVERLAY_PATH additionally points at a mounted per-agent patch
# file, its rows append last, so the agent side wins same-id rows wholesale.
# The platform no longer uploads per-agent copies: empty or missing
# DSH_AGENT_OVERLAY_PATH keeps base + baked agent rows. A failed merge falls
# back to whatever composed so far (base alone, or base + baked) rather than
# failing the boot.
patch_arg=$overlay
if [ -f /usr/local/share/dsh/agent-overlay.yml ]; then
  if python3 /usr/local/share/dsh/merge-overlay.py \
      "$overlay" /usr/local/share/dsh/agent-overlay.yml /tmp/baked-overlay.yml; then
    patch_arg=/tmp/baked-overlay.yml
  else
    echo "dsh-entrypoint: baked agent overlay merge failed; booting on the container base rows" >&2
  fi
fi
if [ -n "${DSH_AGENT_OVERLAY_PATH:-}" ] && [ -f "$DSH_AGENT_OVERLAY_PATH" ]; then
  if python3 /usr/local/share/dsh/merge-overlay.py \
      "$patch_arg" "$DSH_AGENT_OVERLAY_PATH" /tmp/merged-overlay.yml; then
    patch_arg=/tmp/merged-overlay.yml
  else
    echo "dsh-entrypoint: agent overlay merge failed ($DSH_AGENT_OVERLAY_PATH)" >&2
  fi
fi

# MCP servers ride a second --patch layer rendered from the environment at
# boot (dsh --patch is repeatable): dsh-mcp-client takes one server per
# composition entry, so the per-agent row count is dynamic and cannot be a
# static overlay row. Empty env means no layer at all; a failed render aborts
# like the merge above. --patch is a LAUNCHER flag and launcher flags end at
# the first app argument (--no-open), so these join the rewrite below next to
# the overlay --patch, not appended after "$@" like the app-side trusted-host
# flags.
mcp_flags=""
if [ -n "${DSH_MCP_SERVERS:-}" ]; then
  if python3 /usr/local/share/dsh/mcp-overlay.py /tmp/mcp-patch.yml; then
    mcp_flags="--patch /tmp/mcp-patch.yml"
  else
    echo "dsh-entrypoint: mcp overlay render failed (bad DSH_MCP_SERVERS json?)" >&2
    exit 1
  fi
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
  # shellcheck disable=SC2086
  set -- web --patch "$patch_arg" $mcp_flags "$@"
elif [ "${1-}" = "--profile" ] && [ "${2-}" = "web" ]; then
  shift 2
  # shellcheck disable=SC2086
  set -- --profile web --patch "$patch_arg" $mcp_flags "$@"
elif [ "${1-}" = "--profile=web" ]; then
  shift
  # shellcheck disable=SC2086
  set -- --profile=web --patch "$patch_arg" $mcp_flags "$@"
elif [ "${1-}" = "--profile" ] && [ "${2-}" != "" ] && [ "${2-}" != "web" ]; then
  # Per-agent profile (platform single-port process): the merged overlay's
  # all-interfaces webserver bind and the integration rows apply to every
  # profile — without it the process binds loopback inside the container and
  # the preview proxy (the only traffic path) cannot reach it.
  profile="$2"
  shift 2
  # shellcheck disable=SC2086
  set -- --profile "$profile" --patch "$patch_arg" $mcp_flags "$@"
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
