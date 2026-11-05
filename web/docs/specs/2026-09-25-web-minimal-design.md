# dsh-web-minimal 设计文档

日期：2026-09-25
状态：已批准的设计（用户确认）

## 目标

为 DeepSeek Harness 提供一个 out-of-tree 的最小化 Web surface：只保留**对话**（chat）与**轨迹**（trajectory）两个能力。session-id、workspace、settings 等一律从外部指定——URL 参数驱动会话选择，部署配置（cordis.yml）承载其余设置；页面不提供 sidebar、settings 页、模型选择等任何自助 UI。

## 非目标

- 不修改 deepseek-harness 仓库（不新增 `PROFILE_TEMPLATES`、不改 in-box 包）。
- 不新建 Vite 前端入口：复用 `@deepseek-ai/dsh-web-frontend` dist（浏览器 shell 是组合驱动的，渲染内容由 bundle patch 注册的 `dsh.client` 行决定）。
- 不做 SPA 路由 / popstate 监听：仅 boot 时读取一次 `location.search`。
- 不提供只读查看器：会话可交互。

## 仓库形态

单包双 manifest 的独立 npm 包（fallback 方案见「风险」）：

```
dsh-web-minimal/
├── package.json        # dsh.bundle.patch + dsh.client 两个 manifest
├── cordis.patch.yml    # 组合层（本设计的核心交付物）
├── tsdown.config.ts    # 构建 lib/client.js（externalize baseline：react/cordis/client-store/ui-slots/ui-primitives/ui-dockkit）
├── tsconfig.json
├── src/
│   ├── index.ts        # 宿主半区：空 apply（client 包的标准 node half 形态）
│   └── client/         # 浏览器半区：URL → 会话选择（见「URL 契约」）
└── README.md
```

- patch 插入自身行：`- id: ui-minimal-entry; name: dsh-web-minimal`（publish.md 的 hello-plugin 即「patch 引用本包」形态）。
- modules node half 扫描 loader entries 的包 manifest 中的 `dsh.client` 并服务其 `lib/client.js` → 同包双 manifest 在运行时机制上成立；in-box 无先例，实现第一步先做 boot 冒烟验证。
- 包名 `dsh-web-minimal`，ESM，`exports`：`./client`（lib/client.js）、`./package.json`、main（宿主半区）。

## 安装与启动

```sh
dsh plugin --profile web-minimal add /Users/yaohao/work/dsh-web-minimal
# 首次自动初始化 base-backed profile（@deepseek-ai/dsh-base）并追加本 bundle
dsh --profile web-minimal
```

不依赖对 in-box 代码的任何改动：runtime resolution 的 installation scope 对运行中 dsh 安装的依赖图做 BFS，因此 patch 中所有 `@deepseek-ai/*` 行名（web 胶水、client roster、前端 dist 依赖）都能从安装本体解析，无需声明依赖。

## 组合设计（cordis.patch.yml）

### 覆写 base 行

- `system-prompt`：personaSuffix / personaPrefix（与 web-app 相同）。
- `tools`：`mode: !!js process.env.DSH_TOOLS_MODE`（与 web 相同的临时 PTC 开关）。

### 插入：宿主胶水与传输

| 行 id | 包 |
|---|---|
| `web-startup` | `@deepseek-ai/dsh-web-app/startup` |
| `webserver` | `@deepseek-ai/dsh-host-webserver`（inject webStartup；host/port 表达式同 web-app） |
| `web-runtime` | `@deepseek-ai/dsh-web-app`（inject webStartup；openBrowser/printUrl/surfaceContext/trustedHosts 同 web-app） |
| `session-controller` | `@deepseek-ai/dsh-api-session-controller` |
| `workspace` | `@deepseek-ai/dsh-workspace` |
| `workspace-controller` | `@deepseek-ai/dsh-api-workspace-controller` |
| `settings-controller` | `@deepseek-ai/dsh-api-settings-controller` |
| `directory-picker` | `@deepseek-ai/dsh-host-directory-picker-auto`（自动挂载双面 picker） |
| `session-stats` | `@deepseek-ai/dsh-session-stats` |
| `session-turn-outline` | `@deepseek-ai/dsh-session-turn-outline` |
| `modules` | `@deepseek-ai/dsh-client-modules` |
| `connection` | `@deepseek-ai/dsh-client-connection`（inject webRuntime；trustedHosts 表达式同 web-app） |
| `api-remotes` | `@deepseek-ai/dsh-api-remotes` |
| `ui-minimal-entry` | `dsh-web-minimal`（本包） |

### 插入：浏览器 roster（对话 + 轨迹及运行必需）

`locale`、`ui-theme`、`ui-layout`、`ui-renderer`、`ui-session`、`resources`、`ui-conversation`、`ui-chat`、`ui-tool`、`ui-trajectory`、`ui-approval`、`ui-user-questions`、`file-upload`（client-file-upload）、`ui-workspace`、`ui-settings`、`ui-sidebar-right`。

后四行不可省略，已核对保留行存在**插件级 `inject` 强依赖**（缺失会永久 PENDING）：

- `ui-conversation` → `fileUpload`（client-file-upload）、`uiWorkspace`（ui-workspace）、`configForms`（ui-settings）
- `ui-chat` → `uiWorkspace`、`sidebarRight`（ui-sidebar-right）、`configForms`
- `ui-theme` / `locale` → `configForms`

这些行的 UI 大多渲染进被省略行拥有的 slot（左 sidebar、settings 页导航），故不产生可见面板。`ui-conversation` 对 `commandUi`（ui-commands）的注入是 apply 内部的迟到 `ctx.inject`，缺失时不阻塞激活，仅少一个 `/file` 命令——ui-commands 可安全省略。

### 插入：agent 面（照 web-app 移到 preset 后）

- 与 web-app 相同的 disable 列表（tool-bash/pwsh/jobs/fs/fs-search/skill/goal/plan/compaction/subagent 系/workflow/todo/web/agent-instructions 等）。
- `agent-preset-registry` 默认 `minimal`；声明一个 preset（persona + persistent shell，即 web-app `presets/minimal.patch.yml` 的内容，含 win32 平台门控）。

### 去掉（相对 web-app）

sidebar 全家、settings 页面全家（general/models/plugins/shell/agent-loop/subagent/web-search/account）、plugin-manager UI、deliverables、workspace-changes、jobs、plan、goal、schedule、message-feedback、model-selection、permission-presets、agent-preset UI、brand、attachment、input-trigger/commands/skill/reference/subagent UI、open-in-app、documentpreview/browser tabs、office-to-pdf、ui-cordis、workflow-run、session-log-download、session-reference/file-reference-local、subagent-model-selection-settings、client-hmr、session-query-sqlite 覆写（base 默认即 `openAt: never`）。

## URL 契约（浏览器半区）

仅识别 `session`、`workspace` 两个查询参数（`URLSearchParams` 解析，其余参数忽略）：

1. `?session=<id>`：`sessions.retain(sessionId, { source: 'mainView' })`。会话不存在或 retain 失败 → 渲染显式错误空态（fail loud，不自动新建）。
2. 无 `session`，有 `?workspace=<path>`：`workspaces.create({ path })`（Host 幂等：已存在即复用）→ `sessions.create({ workspaceId })` → retain。
3. 两者皆无：`workspaces.initializeDefault(...)`（同全量应用的默认工作区路径）→ `sessions.create({ workspaceId })` → retain。

机制依据（已核对源码）：`ui-session` 的「当前会话」完全由 `source: 'mainView'` 的 retention 派生；conversation 主面板（AppFrame `main` slot 的 `conversation` entry）自动渲染被 retain 的会话；AppFrame 空 sidebar 自动折叠。会话创建走 `session.create` 后 retain；创建/连接失败显示错误空态并保留重试入口。

## 服务注入（浏览器半区）

apply 内 `ctx.inject(['sessions', ...])` 等待 session-controller / workspace-controller 客户端服务就绪后再驱动导航；组件不接触 ctx（仓库 client 纪律同样适用于本包）。本包不注册 slot。

## 构建与依赖声明

- `tsdown.config.ts`：构建 `lib/client.js`；externalize baseline 与 in-box client 包一致；`lib/types` 输出类型。
- `peerDependencies` + `devDependencies`：`@deepseek-ai/cordis`（与宿主共享实例）；`devDependencies` 另含类型所需的已发布 `@deepseek-ai/*` 包。
- `files`：`lib/`、`cordis.patch.yml`、`README.md`。

## 测试计划

- vitest 单测（node 环境）：
  - URL 解析矩阵（有/无 session、有/无 workspace、非法值、多余参数忽略）。
  - 导航流程：retain 已有会话；create→retain；initializeDefault→create→retain；失败 → 错误空态（mock `sessions`/`workspaces` 服务）。
- boot 冒烟（手动手册，写入 README）：`dsh plugin add` → `--dump-config` 断言层存在 → `dsh --profile web-minimal` 打开页面验证对话与轨迹。
- 实现第一步的验证门：双 manifest 包的 `dsh.client` 行能被 modules 扫描发现（boot 后 `/plugins/ui-minimal-entry/client.js` 可取回）；失败则回退双包方案。

## 风险

1. **双 manifest 无 in-box 先例**：运行时机制（modules 扫描 loader entries 的包 manifest）已从源码核对，但无既有组合证明。缓解：实现第一步做冒烟；fallback 为仓库内两个包（bundle 依赖 client 包以真实 semver 声明，分别 `dsh plugin add`，client 包走 plain-dependency 安装路径）。
2. **保留行新增依赖未来变化**：ui-conversation/ui-chat 的插件级 inject 清单将来可能增加对被省略行的依赖。缓解：README 记录「最小 roster 的强依赖来源」，升级 dsh 版本时按同法核对。
3. **ui-workspace / ui-settings 的可见残留**：空态 hero 可能出现工作区选择入口（conversation.hero slot）。属可接受的对话空态 UX；若显示异常再评估。
