#!/usr/bin/env sh
# DSH_META_DIR bootstrap smoke: run dsh-entrypoint.sh against a stub dsh and
# assert the boot contract —
#   1. complete metadata dir (overlay.yml + env.list): env.list is sourced
#      (single-quote escaping holds, meta env wins over the derived
#      DSH_BIND_HOST) and exactly one --patch follows, pointing inside the dir;
#   2. DSH_META_DIR unset, or set without overlay.yml: bare boot, no --patch;
#   3. an invocation already carrying --patch runs verbatim.
# Runs on the host with sh (python3 only softens the bind-host derivation;
# /tmp/dsh.log is the entrypoint's fixed log path and gets clobbered).
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
entrypoint=$script_dir/../dsh-entrypoint.sh

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
stub_bin=$tmp/bin
capture=$tmp/args
capture_env=$tmp/env
mkdir -p "$stub_bin"

cat > "$stub_bin/dsh" <<STUB
#!/bin/sh
printf 'ARG:%s\n' "\$@" > "$capture"
env > "$capture_env"
exit 0
STUB
chmod +x "$stub_bin/dsh"

meta=$tmp/meta
mkdir -p "$meta"
cat > "$meta/overlay.yml" <<'EOF'
- id: webserver
  config:
    host: !!js process.env.DSH_BIND_HOST || '127.0.0.1'
EOF
cat > "$meta/env.list" <<'EOF'
DSH_SYSTEM_PROMPT='You are "#1"; it'\''s a $test \ here'
DSH_TEST_EMPTY=''
DSH_BIND_HOST='10.1.2.3'
EOF

fail() { echo "smoke-entrypoint: $1" >&2; exit 1; }

# run_boot ENV_ARGS... — exec the entrypoint (web profile, fixed tail args)
# through env(1) and require the stub dsh to have run.
run_boot() {
  rm -f "$capture" "$capture_env"
  if ! env "$@" "$entrypoint" --profile web --no-open; then
    fail "entrypoint exited nonzero (env: $*)"
  fi
  [ -s "$capture" ] || fail "stub dsh was not invoked"
}

arg_after_patch() {
  awk -v marker="ARG:--patch" '$0 == marker { getline; print; exit }' "$capture"
}

# ── 1. complete metadata dir ─────────────────────────────────────────────────
run_boot DSH_META_DIR="$meta" PATH="$stub_bin:$PATH" DSH_HOME="$tmp/dsh-home"

count=$(grep -cFx -- 'ARG:--patch' "$capture" || true)
[ "$count" = "1" ] || fail "expected exactly one --patch arg, got $count"
[ "$(arg_after_patch)" = "ARG:$meta/overlay.yml" ] ||
  fail "--patch must point at \$DSH_META_DIR/overlay.yml, got: $(arg_after_patch)"
grep -Fxq -- 'ARG:--profile' "$capture" || fail "profile flag lost"
grep -Fxq -- 'ARG:--no-open' "$capture" || fail "caller args lost"

grep -Fxq -- "DSH_SYSTEM_PROMPT=You are \"#1\"; it's a \$test \\ here" "$capture_env" ||
  fail "env.list single-quote escaping broke DSH_SYSTEM_PROMPT"
grep -Fxq -- 'DSH_TEST_EMPTY=' "$capture_env" || fail "empty env.list value broke"
grep -Fxq -- 'DSH_BIND_HOST=10.1.2.3' "$capture_env" ||
  fail "env.list must win over the derived DSH_BIND_HOST"
echo "meta-dir boot ok: --patch $meta/overlay.yml, env.list sourced"

# ── 2a. DSH_META_DIR unset → bare boot ──────────────────────────────────────
run_boot -u DSH_META_DIR PATH="$stub_bin:$PATH" DSH_HOME="$tmp/dsh-home"
! grep -Fxq -- 'ARG:--patch' "$capture" ||
  fail "unset DSH_META_DIR must boot bare (no --patch), got: $(cat "$capture")"
echo "bare boot ok (unset DSH_META_DIR)"

# ── 2b. incomplete metadata dir (overlay.yml missing) → bare boot ───────────
run_boot DSH_META_DIR="$tmp/no-such-dir" PATH="$stub_bin:$PATH" DSH_HOME="$tmp/dsh-home"
! grep -Fxq -- 'ARG:--patch' "$capture" ||
  fail "incomplete DSH_META_DIR must boot bare (no --patch), got: $(cat "$capture")"
echo "bare boot ok (incomplete DSH_META_DIR)"

# ── 2c. env.list without overlay.yml must NOT be sourced ────────────────────
mkdir -p "$tmp/env-only"
cp "$meta/env.list" "$tmp/env-only/env.list"
run_boot DSH_META_DIR="$tmp/env-only" PATH="$stub_bin:$PATH" DSH_HOME="$tmp/dsh-home"
! grep -Fxq -- 'ARG:--patch' "$capture" ||
  fail "env-only DSH_META_DIR must boot bare, got: $(cat "$capture")"
! grep -q '^DSH_SYSTEM_PROMPT=' "$capture_env" ||
  fail "env.list must not be sourced when overlay.yml is missing"
echo "env-only dir ok (env.list not sourced)"

# ── 1b. per-agent profile branch (the platform boot path) ───────────────────
run_with() {
  rm -f "$capture" "$capture_env"
  if ! env "$@" "$entrypoint" --profile "$agent_profile" --port 4123; then
    fail "entrypoint exited nonzero (env: $*)"
  fi
  [ -s "$capture" ] || fail "stub dsh was not invoked"
}
agent_profile=agent-3f
run_with DSH_META_DIR="$meta" PATH="$stub_bin:$PATH" DSH_HOME="$tmp/dsh-home"
[ "$(arg_after_patch)" = "ARG:$meta/overlay.yml" ] ||
  fail "per-agent profile must patch from the metadata dir, got: $(arg_after_patch)"
grep -Fxq -- "ARG:--profile" "$capture" || fail "profile flag lost"
grep -Fxq -- "ARG:$agent_profile" "$capture" || fail "agent profile argument lost"
grep -Fxq -- 'ARG:--port' "$capture" || fail "port flag lost"
echo "per-agent profile boot ok: --patch $meta/overlay.yml"

# ── 1c. metadata path with a space survives argument assembly ───────────────
space_meta="$tmp/meta dir"
mkdir -p "$space_meta"
cp "$meta/overlay.yml" "$space_meta/overlay.yml"
cp "$meta/env.list" "$space_meta/env.list"
run_boot DSH_META_DIR="$space_meta" PATH="$stub_bin:$PATH" DSH_HOME="$tmp/dsh-home"
count=$(grep -cFx -- 'ARG:--patch' "$capture" || true)
[ "$count" = "1" ] || fail "spaced path: expected one --patch, got $count"
[ "$(arg_after_patch)" = "ARG:$space_meta/overlay.yml" ] ||
  fail "spaced path must stay one argument, got: $(cat "$capture")"
echo "spaced metadata path ok"

# ── 3. caller-carried --patch runs verbatim ─────────────────────────────────
rm -f "$capture" "$capture_env"
if ! env PATH="$stub_bin:$PATH" DSH_HOME="$tmp/dsh-home" \
  "$entrypoint" --patch "$tmp/own.yml" --profile web; then
  fail "entrypoint exited nonzero (verbatim)"
fi
printf 'ARG:%s\n' --patch "$tmp/own.yml" --profile web > "$tmp/expected"
cmp -s "$tmp/expected" "$capture" ||
  fail "verbatim invocation rewritten, got: $(cat "$capture")"
echo "verbatim --patch ok"

echo "smoke-entrypoint: all scenarios ok"
