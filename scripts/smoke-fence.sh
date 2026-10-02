#!/usr/bin/env sh
# Fence fork smoke: build the image, boot the web profile with and without
# DSH_TRUSTED_ORIGINS, and probe /api from inside each container with
# browser-shaped headers (urllib; Host explicitly the loopback authority the
# Host fence already trusts). The fence judges before browser auth, so the
# HTTP code separates the two layers: 403 = fence refusal, 401 = fence passed,
# cookie/token missing. Four assertions:
#   1. allowlisted Origin + Sec-Fetch-Site: cross-site → 401 (fence passed)
#   2. non-allowlisted cross-site Origin    → 403 (fence refused)
#   3. Origin: null (sandboxed iframe)      → 403 (fence refused)
#   4. control container without the env, same allowlisted Origin → 403
#      (empty allowlist = upstream behavior)
# Direct-link WS auth (query token ≡ cookie on the remote.mux upgrade):
#   5. ws /api/remote.mux?token=<launch token>      → OPEN
#   6. ws /api/remote.mux?token=<wrong value>       → HTTP 401
# Usage: scripts/smoke-fence.sh [image] (default dsh-server:test).
# SMOKE_SKIP_BUILD=1 skips the docker build and probes the image as-is.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
image=${1:-dsh-server:test}

if [ "${SMOKE_SKIP_BUILD:-0}" != 1 ]; then
  docker build -t "$image" "$script_dir/.."
fi

name_allow=dsh-fence-smoke-allow
name_ctrl=dsh-fence-smoke-control
cleanup() {
  docker rm -f "$name_allow" "$name_ctrl" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup

docker run -d --name "$name_allow" -e DSH_TRUSTED_ORIGINS=https://app.example.com "$image" >/dev/null
docker run -d --name "$name_ctrl" "$image" >/dev/null

# The webserver answers 401/403 on /api once booted; connection-refused means
# not ready yet. 120 s covers first-boot profile resolution.
for name in "$name_allow" "$name_ctrl"; do
  tries=0
  until docker exec "$name" python3 -c "
import sys, urllib.error, urllib.request
try:
    urllib.request.urlopen('http://127.0.0.1:3080/api/', timeout=2)
except urllib.error.HTTPError:
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      echo "smoke-fence: $name did not come up" >&2
      docker logs "$name" 2>&1 | tail -40 >&2 || true
      exit 1
    fi
    sleep 2
  done
done

docker exec -i "$name_allow" python3 - <<'PY'
import urllib.error
import urllib.request

def status(headers):
    request = urllib.request.Request(
        'http://127.0.0.1:3080/api/',
        headers={'Host': '127.0.0.1:3080', 'Sec-Fetch-Mode': 'cors', **headers})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code

# 401 = fence passed, browser auth refused; 403 would mean the fence refused.
code = status({'Origin': 'https://app.example.com', 'Sec-Fetch-Site': 'cross-site'})
assert code == 401, f'allowlisted origin must pass the fence (401), got {code}'

code = status({'Origin': 'https://evil.example.net', 'Sec-Fetch-Site': 'cross-site'})
assert code == 403, f'non-allowlisted cross-site origin must be fenced (403), got {code}'

code = status({'Origin': 'null', 'Sec-Fetch-Site': 'cross-site'})
assert code == 403, f'opaque origin "null" must be fenced (403), got {code}'

print('smoke-fence: allowlist container 3/3 ok')
PY

docker exec -i "$name_ctrl" python3 - <<'PY'
import urllib.error
import urllib.request

def status(headers):
    request = urllib.request.Request(
        'http://127.0.0.1:3080/api/',
        headers={'Host': '127.0.0.1:3080', 'Sec-Fetch-Mode': 'cors', **headers})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code

# Empty allowlist = upstream behavior: the cross-site allowlisted-looking
# Origin is fenced exactly as upstream would.
code = status({'Origin': 'https://app.example.com', 'Sec-Fetch-Site': 'cross-site'})
assert code == 403, f'without DSH_TRUSTED_ORIGINS the origin must be fenced (403), got {code}'

print('smoke-fence: control container 1/1 ok')
PY

# Direct-link WS auth: the python websockets client sends no Origin against
# the loopback Host, so the fence passes both probes and the outcome isolates
# the auth layer — OPEN = query token accepted, 401 = refused.
docker exec "$name_allow" pip install --no-cache-dir --break-system-packages -q 'websockets>=14'

launch_url=$(docker logs "$name_allow" 2>&1 | sed -n 's/.*dsh web: \([^ ]*\).*/\1/p' | head -1)
if [ -z "$launch_url" ]; then
  echo "smoke-fence: no 'dsh web:' launch URL in $name_allow logs" >&2
  docker logs "$name_allow" 2>&1 | tail -40 >&2 || true
  exit 1
fi

docker exec -i -e LAUNCH_URL="$launch_url" "$name_allow" python3 - <<'PY'
import asyncio
import os
import urllib.parse

import websockets

token = urllib.parse.parse_qs(urllib.parse.urlparse(os.environ['LAUNCH_URL']).query)['token'][0]
base = 'ws://127.0.0.1:3080/api/remote.mux'


def refusal_status(error: Exception) -> int | None:
    response = getattr(error, 'response', None)
    return getattr(response, 'status_code', None) or getattr(error, 'status_code', None)


async def main() -> None:
    async with websockets.connect(f'{base}?token={token}', open_timeout=10):
        pass

    try:
        await websockets.connect(f'{base}?token=not-the-launch-token', open_timeout=10)
    except Exception as error:
        status = refusal_status(error)
        assert status == 401, f'wrong token must be refused with 401, got {status!r} ({error!r})'
    else:
        raise AssertionError('wrong token must be refused with 401, connection opened')

asyncio.run(main())
print('smoke-fence: ws query-token auth 2/2 ok')
PY

echo "smoke-fence: 6/6 assertions ok ($image)"
