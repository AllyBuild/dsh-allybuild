#!/usr/bin/env sh
# Merge-channel smoke: fabricate base+agent overlays in the production shape
# (top-level patch rows, !!js env expressions), run the image's merge-overlay.py,
# and assert row ordering, same-id deep override, insert passthrough, and !!
# js-expression passthrough. Runs on the host with python3+pyyaml, or inside
# the image.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
merge_py=""
for candidate in "$script_dir/../merge-overlay.py" /usr/local/share/dsh/merge-overlay.py; do
  if [ -f "$candidate" ]; then
    merge_py=$candidate
    break
  fi
done
if [ -z "$merge_py" ]; then
  echo "smoke-entrypoint: merge-overlay.py not found" >&2
  exit 1
fi
mcp_py=$(dirname -- "$merge_py")/mcp-overlay.py
if [ ! -f "$mcp_py" ]; then
  echo "smoke-entrypoint: mcp-overlay.py not found" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/base.yml" <<'EOF'
- id: webserver
  config:
    host: '0.0.0.0'
    port: !!js ctx.webStartup.port ?? 3080
- insert:
    - id: allybuild-answerer
      name: '@deepseek-ai/dsh-allybuild-answerer'
      config:
        url: !!js process.env.ALLYBUILD_ANSWER_URL ?? ''
EOF

cat > "$tmp/agent.yml" <<'EOF'
- id: webserver
  config:
    port: 9999
- id: system-prompt
  config:
    persona: !!js process.env.DSH_SYSTEM_PROMPT ?? ''
- id: skill-filesystem
  disabled: false
  config:
    customSkillDirs: !!js (process.env.DSH_SKILL_DIRS ?? '').split(',').filter(Boolean)
- id: llm-deepseek
  config:
    maxTokens: 32768
- id: agent-default-model
  config:
    provider: deepseek-official
    model: !!js process.env.DSH_MODEL ?? 'deepseek-v4-flash'
EOF

python3 "$merge_py" "$tmp/base.yml" "$tmp/agent.yml" "$tmp/merged.yml"

python3 - "$merge_py" "$tmp/merged.yml" <<'PY'
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("merge_overlay", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with open(sys.argv[2]) as f:
    merged = mod.yaml.load(f, Loader=mod.OverlayLoader)

ids = [row.get("id", "insert") for row in merged]
assert ids == [
    "webserver",
    "insert",
    "webserver",
    "system-prompt",
    "skill-filesystem",
    "llm-deepseek",
    "agent-default-model",
], ids

assert merged[0]["config"]["host"] == "0.0.0.0", merged[0]["config"]
assert merged[2]["config"] == {"port": 9999}, merged[2]["config"]

persona = merged[3]["config"]["persona"]
assert isinstance(persona, mod.TaggedScalar), repr(persona)
assert persona.tag == "tag:yaml.org,2002:js", persona.tag
assert persona.value == "process.env.DSH_SYSTEM_PROMPT ?? ''", persona.value

model = merged[6]["config"]["model"]
assert isinstance(model, mod.TaggedScalar), repr(model)
assert model.value == "process.env.DSH_MODEL ?? 'deepseek-v4-flash'", model.value
assert merged[6]["config"]["provider"] == "deepseek-official"
assert merged[5]["config"]["maxTokens"] == 32768
assert merged[4]["disabled"] is False

print("merge smoke ok:", ids)
PY

# ── MCP layer render ─────────────────────────────────────────────────────────
# Rows must match legacy _render_cordis blocks: same entry dicts, same key
# order (safe_dump sort_keys), url-less entries skipped. Empty env renders an
# empty patch list; malformed JSON must fail loud.

DSH_MCP_SERVERS='[{"name":"allybuild","url":"https://api.example.test/projects/1/mcp","headers":{"Authorization":"Bearer tok"}},{"name":"no-url"},{"name":"search","url":"https://mcp.example.test/s"}]' \
  python3 "$mcp_py" "$tmp/mcp.yml"

python3 - "$tmp/mcp.yml" <<'PY'
import sys
import yaml

with open(sys.argv[1]) as f:
    rows = yaml.safe_load(f)

assert rows == [
    {"insert": [{
        "id": "mcp-allybuild",
        "name": "@deepseek-ai/dsh-mcp-client",
        "config": {
            "headers": {"Authorization": "Bearer tok"},
            "serverName": "allybuild",
            "transport": "streamable-http",
            "url": "https://api.example.test/projects/1/mcp",
        },
    }]},
    {"insert": [{
        "id": "mcp-search",
        "name": "@deepseek-ai/dsh-mcp-client",
        "config": {
            "serverName": "search",
            "transport": "streamable-http",
            "url": "https://mcp.example.test/s",
        },
    }]},
], rows

with open(sys.argv[1]) as f:
    text = f.read()
assert text.startswith("- insert:\n  - config:\n"), text[:60]
assert "name: '@deepseek-ai/dsh-mcp-client'\n" in text, text

print("mcp rows ok:", [e["id"] for row in rows for e in row["insert"]])
PY

env -u DSH_MCP_SERVERS python3 "$mcp_py" "$tmp/mcp-empty.yml"
grep -qx '\[\]' "$tmp/mcp-empty.yml" || { echo "smoke-entrypoint: empty env must render []" >&2; exit 1; }

DSH_MCP_SERVERS='' python3 "$mcp_py" "$tmp/mcp-blank.yml"
grep -qx '\[\]' "$tmp/mcp-blank.yml" || { echo "smoke-entrypoint: blank env must render []" >&2; exit 1; }

if DSH_MCP_SERVERS='{"name":"not-a-list"}' python3 "$mcp_py" "$tmp/mcp-bad.yml" 2>/dev/null; then
  echo "smoke-entrypoint: non-array DSH_MCP_SERVERS must fail" >&2
  exit 1
fi
if DSH_MCP_SERVERS='[{"url":"u"}]' python3 "$mcp_py" "$tmp/mcp-bad2.yml" 2>/dev/null; then
  echo "smoke-entrypoint: url without name must fail" >&2
  exit 1
fi
if DSH_MCP_SERVERS='{nope' python3 "$mcp_py" "$tmp/mcp-bad3.yml" 2>/dev/null; then
  echo "smoke-entrypoint: malformed json must fail" >&2
  exit 1
fi

echo "mcp empty/failure cases ok"
