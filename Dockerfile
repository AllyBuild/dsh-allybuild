# dsh-server image: the remote server role of the split deployment.
# Source build following the allybuild-dsh pattern: the AllyBuild-local plugin
# packages (allybuild-overlay/) must live INSIDE the harness workspace to build
# (workspace:^ peers, shared tsconfig solution), so stage 1 clones the pinned
# upstream, stamps the overlay over it, and builds the full workspace; stage 2
# runs the dsh CLI from that tree. The npm-installed image cannot carry these
# plugins: they are private, and not on any registry.
FROM node:24-slim AS dsh-src

ARG DSH_SOURCE_REF=dsh-v0.1.7-rc.2

# The harness build chain: git (source clone + the fabricated repo identity
# scripts/build.ts reads), python3 (build scripts), and the native toolchain
# workspace dependencies compile with.
# deb.debian.org 502s through some networks (Fastly edge); the tsinghua mirror
# serves both the local build host and CI reliably.
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    git ca-certificates python3 make g++ pkg-config rsync \
  && rm -rf /var/lib/apt/lists/*

# Pinned upstream: the tag matches the npm release line the deployment tracks.
RUN git clone --depth 1 --branch "${DSH_SOURCE_REF}" \
    https://github.com/deepseek-ai/deepseek-harness /src

# Stamp the AllyBuild-local packages over the pinned checkout (build.sh's
# rsync step) and wire them into the host typecheck solution — without the
# tsconfig.host references the aggregate build never compiles them.
# Everything is authored under packages/plugins, which the upstream workspace
# glob (packages/*/*) covers as-is — except connection, which overlays the
# UPSTREAM package: it is stamped onto packages/client/connection explicitly
# and the authored copy removed — same-name twins would trip pnpm's duplicate
# workspace-name check, and the upstream path is what every consumer resolves.
COPY allybuild-overlay /tmp/allybuild-overlay
RUN rsync -a /tmp/allybuild-overlay/ /src/ \
  && rsync --delete -a /tmp/allybuild-overlay/packages/plugins/connection/ /src/packages/client/connection/ \
  && rm -rf /src/packages/plugins/connection \
  && python3 - <<'PY'
path = "/src/tsconfig.host.json"
text = open(path).read()
entries = ('"./packages/plugins/session-sync"', '"./packages/plugins/progress-sync"',
           '"./packages/plugins/answerer"')
anchor = '{ "path": "./packages/core/agent-default-model" },'
assert anchor in text, "tsconfig.host.json anchor missing (upstream shape changed?)"
for entry in entries:
    if entry not in text:
        text = text.replace(anchor, anchor + f"\n    {{ \"path\": {entry} }},", 1)
open(path, "w").write(text)

# The overlay merge forces --no-frozen-lockfile below, and the re-resolution
# pulls micromark-util-types 2.0.3 next to the upstream lock's 2.0.2 — the
# two versions' TokenTypeMap disagree and upstream's parse.ts fails
# typecheck. Pin every resolution to the lock's version via the workspace
# yaml's overrides map (pnpm 11 ignores package.json pnpm.overrides).
path = "/src/pnpm-workspace.yaml"
lines = open(path).read().splitlines(keepends=True)
needle = "overrides:\n"
assert needle in lines, "pnpm-workspace.yaml overrides anchor missing (upstream shape changed?)"
if not any("micromark-util-types" in line for line in lines):
    lines.insert(lines.index(needle) + 1, "  'micromark-util-types': '2.0.2'\n")
open(path, "w").writelines(lines)
PY

RUN corepack enable \
  && cd /src \
  && pnpm config set registry https://registry.npmmirror.com \
  && pnpm config set fetch-timeout 600000 \
  && pnpm config set fetch-retries 5 \
  && pnpm install --no-frozen-lockfile \
  && pnpm run build

# dsh-web-minimal builds here too (its lib/ is gitignored, so the image build
# is the only place the artifact exists). Same corepack/pnpm config as above;
# its own lockfile and workspace file govern the install. devDependencies
# (toolchain + test rig) are pruned after the build — the runtime surface is
# lib/ + package metadata only, exactly what the baked copy used to ship.
COPY web-minimal /tmp/web-minimal
RUN cd /tmp/web-minimal \
  && pnpm install --no-frozen-lockfile \
  && pnpm run build \
  && rm -rf node_modules

# ── Runtime stage ────────────────────────────────────────────────────────────

FROM node:24-slim

# git backs the agent workspace tools (changed-files snapshots); socat-free
# image: the webserver binds all interfaces directly here. pnpm (corepack)
# backs the CLI's plugin-manager operations inside profiles.
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends git ca-certificates python3 python3-pip python3-venv python3-yaml xdg-user-dirs \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

# TaskFlow script-task language face: tsx runs TypeScript task slots; python3
# (bookworm = 3.11) comes from the apt layer above.
RUN npm install -g --registry=https://registry.npmmirror.com tsx@4 \
    && tsx --version \
    && python3 --version

# TaskFlow script SDKs: baked so task slots carry only the script + workflow
# entry + reactive libs. Versions move with the image tag, not per-task upload.
# Resolution (verified empirically): tsx treats package.json-less slots as CJS
# and transpiles `import` to `require`, which NODE_PATH resolves; ESM-mode
# slots (a `"type": "module"` package.json above the slot) and dynamic
# import() bypass NODE_PATH — Node ESM has no global search path — so the
# baked tsconfig adds a `paths` mapping that tsx's resolver honors in every
# mode. Either mechanism alone covers only its half; both together cover all.
# @allybuild/sdk stays on the default registry: npmmirror does not mirror the
# private scope (404).
RUN npm install -g @allybuild/sdk@1.1.0 \
    && pip install --no-cache-dir --break-system-packages allybuild-sdk==1.1.0 \
    && mkdir -p /etc/allybuild \
    && printf '%s\n' \
      '{' \
      '  "compilerOptions": {' \
      '    "baseUrl": "/",' \
      '    "paths": { "@allybuild/sdk": ["/usr/local/lib/node_modules/@allybuild/sdk/dist/index.js"] }' \
      '  }' \
      '}' > /etc/allybuild/tsconfig.json
ENV NODE_PATH=/usr/local/lib/node_modules \
    TSX_TSCONFIG_PATH=/etc/allybuild/tsconfig.json

# dsh-web-minimal: minimal surface (conversation + trajectory; session/
# workspace arrive via ?session=/?workspace=), built from the vendored source
# in the dsh-src stage above. Per-agent profiles materialize from it with
# `dsh plugin --profile <id> add`.
COPY --from=dsh-src --chmod=0755 /tmp/web-minimal /dsh/web-minimal

# The built workspace ships with its node_modules (pnpm symlinks stay relative
# and keep working under the new root); the CLI runs from the built bin.
COPY --from=dsh-src /src /dsh
RUN ln -sf /dsh/apps/cli/lib/bin.js /usr/local/bin/dsh \
  && chmod +x /dsh/apps/cli/lib/bin.js \
  && dsh --version

# Profiles, sessions, and credential state live under DSH_HOME; the volume
# keeps browser-auth cookies and session logs across container replacement.
ENV DSH_HOME=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data

# TaskFlow 平台面挂载根：任务 slot 与 agent overlay/DSH_HOME 都落在
# /workspace/.allybuild 下，镜像预建并交给 node（镜像无 sudo，平台脚本无法自建）。
RUN mkdir -p /workspace && chown node:node /workspace

COPY --chmod=0755 dsh-entrypoint.sh /usr/local/bin/dsh-entrypoint
COPY docker-overlay.yml merge-overlay.py mcp-overlay.py agent-overlay.yml /usr/local/share/dsh/

EXPOSE 3080

USER node

# The entrypoint injects the all-interfaces bind overlay plus the AllyBuild
# plugin rows (inert until ALLYBUILD_* env configures them) for the web
# profile. Arguments appended to `docker run` pass through to dsh.
ENTRYPOINT ["dsh-entrypoint"]
CMD ["--profile", "web", "--no-open"]
