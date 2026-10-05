#!/usr/bin/env bash
# Materialize the released 双语 SDK into the build context.
#
# CI 只检出了 runtime 子模块（checkout path: runtime），而 Dockerfile 的
# COPY 期望主仓根布局（sdk/ts/*.tgz + sdk/python 源码目录）。本脚本从
# registry 物化等价内容：
#   TS   → npm pack @allybuild/sdk@latest 落 sdk/ts/*.tgz（与本地
#          `npm run build && npm pack` 产物同布局，Dockerfile 同一安装路径）
#   Py   → PyPI sdist 解包到 sdk/python/（pyproject + allybuild_sdk/
#          源码目录，与仓内源码同布局）
# 双语包独立发布、版本可能不对称（npm latest 与 PyPI latest 各自解析）。
# CI 镜像语义 = released SDK 通道；本地构建 = source SDK 通道（见
# Dockerfile 注释）。任一 registry 缺包立即失败——绝不静默装半套。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "${ROOT}/sdk/ts" "${ROOT}/sdk/python"

TS_VERSION="$(npm view @allybuild/sdk version)"
PY_VERSION="$(python3 -c 'import json,urllib.request; print(json.load(urllib.request.urlopen("https://pypi.org/pypi/allybuild-sdk/json"))["info"]["version"])')"
echo "ci-sdk: @allybuild/sdk ${TS_VERSION} / allybuild-sdk ${PY_VERSION}"

npm pack "@allybuild/sdk@${TS_VERSION}" --pack-destination "${ROOT}/sdk/ts"

SDIST_DIR="$(mktemp -d)"
python3 -m pip download "allybuild-sdk==${PY_VERSION}" --no-deps \
  --no-binary :all: -d "${SDIST_DIR}" >/dev/null
tar -xzf "${SDIST_DIR}/allybuild_sdk-${PY_VERSION}.tar.gz" -C "${SDIST_DIR}" \
  --strip-components=1
test -f "${SDIST_DIR}/pyproject.toml"
test -d "${SDIST_DIR}/allybuild_sdk"
cp -a "${SDIST_DIR}/." "${ROOT}/sdk/python/"
rm -rf "${SDIST_DIR}"

echo "ci-sdk: sdk/ts/$(cd "${ROOT}/sdk/ts" && ls *.tgz)"
echo "ci-sdk: sdk/python entries: $(ls "${ROOT}/sdk/python" | tr '\n' ' ')"
