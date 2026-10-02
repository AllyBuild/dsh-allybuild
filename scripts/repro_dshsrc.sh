#!/bin/sh
# 复刻 runtime/Dockerfile 的 dsh-src 构建段（本地验证用；node:slim 成品镜像缺
# rsync/cc，用 cp 替代 rsync、跳过 native 编译只跑 TS 面）。
set -e
git clone -q --depth 1 --branch "${DSH_REF:-dsh-v0.1.7-rc.2}" https://github.com/deepseek-ai/deepseek-harness /tmp/src 2>/dev/null
cd /tmp/src
cp -a /rt/allybuild-overlay/. ./
cp -a /rt/allybuild-overlay/packages/plugins/connection/. packages/client/connection/
rm -rf packages/plugins/connection
python3 /rt/scripts/repro_dshsrc_edits.py
corepack enable
pnpm config set registry https://registry.npmmirror.com >/dev/null
pnpm config set fetch-timeout 600000 >/dev/null
pnpm config set fetch-retries 5 >/dev/null
pnpm install --no-frozen-lockfile >/dev/null 2>&1
echo "== host leg:"
pnpm run build:lib:host >/tmp/h.log 2>&1 && echo HOST-OK || { echo HOST-FAIL; grep -E 'error TS' /tmp/h.log | head -3; exit 1; }
echo "== client tsc:"
./node_modules/.bin/tsc -b tsconfig.client.json >/tmp/c.log 2>&1 && echo CLIENT-OK || { echo CLIENT-FAIL; grep -cE 'error TS' /tmp/c.log; grep -E 'error TS' /tmp/c.log | head -4; exit 1; }
echo ALL-GREEN
