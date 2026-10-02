# dsh-server

DeepSeek Harness 的拆分部署仓库：服务端容器镜像与 Daytona 一键部署脚本。镜像从
上游源码构建（Daytona/CI 内自动 clone 固定 tag），并叠加
`allybuild-overlay/` 中的 AllyBuild 集成插件（会话元数据同步、任务进度同步、
ask_user 应答器）。上游源码见
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

## 镜像

镜像内的 dsh 从上游源码构建：构建期 clone 固定的上游 tag（`DSH_SOURCE_REF`，
如 `dsh-v0.1.7-rc.1`），叠印 `allybuild-overlay/` 后全仓编译，运行 stage 直接
从该源码树启动 CLI——私有插件不在任何 registry 上，npm 安装形不携带它们。
入口命令为 `dsh --profile web --no-open`：启动 web profile（`/api` 网关 +
浏览器 UI 静态资源），不打开浏览器，只打印带认证 token 的 URL。

```sh
docker build -t dsh-server .

docker run -d --name dsh -p 3080:3080 -v dsh-data:/data \
  -e DEEPSEEK_API_KEY=sk-... \
  dsh-server
```

- 端口映射：容器内由内置 overlay 把 webserver 切到全接口绑定（`0.0.0.0`，
  配置层支持的部署形态；CLI 的 `--host` 旗标出于裸机安全考虑拒绝它）。浏览器访问
  `http://localhost:3080`，其 Host 头被服务端信任栅栏视为 loopback，无需额外配置。
- `docker run` 追加的参数会透传给 dsh，例如 `--port 8080`；自带 `--patch`
  或非 web profile 的调用不会叠加 overlay。
- `/data` 是 `DSH_HOME`：profile、会话记录与浏览器认证凭据都持久化在这里，
  换卷即重置。
- 启动日志里打印的 URL 含 `?token=...`，从宿主机访问时把其中的 host 换成
  `localhost:3080`（token 不变，仅首次打开或换浏览器时需要）：

```sh
docker logs dsh | grep -o 'token=[A-Za-z0-9_-]*'
```

### 发布

`.github/workflows/docker.yml` 在 push 到 `main` 和 `v*` tag 时构建并推送
`ghcr.io/allybuild/dsh-server`，使用内置 `GITHUB_TOKEN`，无需额外 secret；
也可经 `workflow_dispatch` 手动触发，输入 `tag_suffix`（默认空）。

每次构建先解析 npm 上 `@deepseek-ai/dsh` 的最新版本作为镜像 tag（如
`ghcr.io/allybuild/dsh-server:0.1.5-rc.2`）；镜像内的 dsh 由 Dockerfile 内
固定的 `DSH_SOURCE_REF` 从源码构建，随发布同步 bump，tag 与镜像内 dsh 版本
严格一致。`main` push 另有 `latest` 与 `main` tag，`v*` tag 另有语义化版本
tag。`workflow_dispatch` 带 `tag_suffix` 在 `v*` tag ref 上触发时，额外追加
`{{version}}` 拼后缀的 tag（如 `tag_suffix=-tf1` 产出
`ghcr.io/allybuild/dsh-server:0.1.5-rc.2-tf1`）；后缀为空时产出与 push
构建一致。

### 任务脚本语言面

镜像同时是 TaskFlow 脚本任务的执行面：`tsx`（TypeScript）与 `python3`
（bookworm = 3.11）直接运行任务 slot 里的 `workflow.ts` / `workflow.py`。
双语 SDK 烘焙在镜像内，slot 只携带任务脚本与 workflow 入口薄壳：

- npm `@allybuild/sdk`（全局安装，`/usr/local/lib/node_modules`）
- PyPI `allybuild-sdk`（纯标准库，`/usr/local/lib/python3.11/dist-packages`）

**版本语义：SDK 版本随镜像 tag 走**——升级 SDK 即重打镜像，平台不再按任务
上传 SDK，slot 里也不再有版本协商。当前烘焙版本 `@allybuild/sdk@1.0.0` /
`allybuild-sdk==1.0.0`，与镜像内 dsh 版本共同构成 tag 的版本面。

`/workspace` 是平台挂载根（任务 slot 与 agent overlay/DSH_HOME 落在
`/workspace/.allybuild/` 下），镜像预建并 chown 给 node——镜像内无 sudo，
平台脚本否则无法自建目录。

TS 侧解析形态（实测验证）：slot 目录无 `package.json` 时 tsx 按 CJS 处理
`import`（转译为 `require`），`NODE_PATH=/usr/local/lib/node_modules` 负责
解析；若 slot 上方出现 `"type": "module"` 的 `package.json` 或脚本用动态
`import()`，Node ESM 解析器不认 NODE_PATH，由烘焙在 `/etc/allybuild/`
tsconfig 的 `paths` 映射（`TSX_TSCONFIG_PATH`）兜底。两套机制各覆盖一半
解析路径，缺一不可。

语言面与双语 SDK 的首发镜像以 `-tf1` 后缀 tag 发布：在 `v*` tag ref 上经
`workflow_dispatch` 以 `tag_suffix=-tf1` 触发（机制见「发布」），产出如
`ghcr.io/allybuild/dsh-server:0.1.5-rc.2-tf1`。每个 agent 实例另可通过
`DSH_AGENT_OVERLAY_PATH` 挂载 per-agent overlay 补丁，entrypoint 把它合并
进容器 overlay（同 id 行整体由 agent 侧覆盖，合并失败即中止启动），实现
per-agent 人格定制；agent 的 MCP 服务器经 `DSH_MCP_SERVERS` 注入——
`dsh-mcp-client` 每行只承载一个服务器，行数随 agent 动态，entrypoint 在
启动时把该 env 渲染成追加的 `--patch` 层（`mcp-overlay.py`），空/缺省 env
不注入任何行，坏 JSON 中止启动。

## Daytona 部署

一键脚本（Daytona 侧用组织配置的 ghcr 凭据拉取私有镜像，无需公开仓库；
Daytona 拒绝 `latest` tag，脚本自动从 npm 解析当前 dsh 版本作为镜像 tag）：

```sh
export DAYTONA_API_KEY=dtn_...
python3 scripts/deploy_daytona.py            # 部署并打印连接 URL 与 token
python3 scripts/deploy_daytona.py --refresh-snapshot --force-recreate  # 镜像更新后重建
```

等价的手动流程：

```sh
daytona snapshot create dsh-server -i ghcr.io/allybuild/dsh-server:<dsh版本> \
  --memory 2 --disk 5 --sandbox-class container

daytona create --snapshot dsh-server --name dsh-server \
  --auto-stop 0 --public      # 关闭 15 分钟闲置自停
```

沙盒的 hostname 即沙盒 UUID，entrypoint 自动把稳定路由域名
`3080-<uuid>.daytonaproxy01.net` 加入 `/api` 信任栅栏（`daytona preview-url`
打印的短域名每次启动都会变化，不可用）。端口前缀取自 `ALLYBUILD_DSH_PORT`
（缺省 3080）——TaskFlow 平台的 agent dsh 进程跑在任意分配端口，其 preview
authority 为 `<port>-<uuid>.<域名>`。token 从 `/tmp/dsh.log` 读取：

```sh
daytona exec dsh-server -- cat /tmp/dsh.log      # dsh web: http://127.0.0.1:3080/?token=...
```

### AllyBuild 集成

`allybuild-overlay/` 携带三个私有插件，在 web profile 中以独立 overlay 行挂载
（`docker-overlay.yml` 内的 AllyBuild 行），配置经环境变量在启动时注入，全部为空时插件
惰性不生效：

| 环境变量 | 作用 |
| --- | --- |
| `ALLYBUILD_SESSION_URL` | 会话元数据同步端点（session-sync） |
| `ALLYBUILD_PROGRESS_URL` | 任务进度同步端点（progress-sync） |
| `ALLYBUILD_ANSWER_URL` | ask_user 应答端点（answerer） |
| `ALLYBUILD_TOKEN` / `ALLYBUILD_AGENT_ID` | 鉴权与归属 |
| `DSH_MCP_SERVERS` | agent 的 MCP 服务器列表（JSON 数组：`name`/`url`/`headers`；`name` 为已消毒的 serverName） |
| `DSH_TRUSTED_ORIGINS` | 对话面直连的跨站 Origin 白名单（语义与安全纪律见「对话面直连」） |

Daytona 部署时在创建沙盒前 export 这些变量，部署脚本经 `-e` 透传；已运行的
沙盒不会热更新环境，需删除重建。

无公网/局域网直达时，用 SSH 隧道替代 `-p` 映射：

```sh
ssh -L 3080:127.0.0.1:3080 user@remote   # 远程容器内仍由 entrypoint 完成绑定
```

### 对话面直连

平台对话前端从平台页面跨站直达沙盒内的 dsh API。这条路由
两个机制支撑：

- **`DSH_TRUSTED_ORIGINS` 白名单**：逗号分隔的 canonical origin
  （`scheme://host[:port]`）。浏览器跨站请求（`Sec-Fetch-Site: cross-site`）
  与携带 Origin 的请求，Origin 命中白名单即放行；Host 栅栏（DNS rebinding
  防御）与 opaque `"null"` Origin 的拒绝保持不变。空值/缺省 = 上游行为不变。
- **WS `?token=` 鉴权**：`/api` WebSocket 升级请求可用单个 `token` query
  参数（即启动 URL 里的 launch token）直接通过认证，免去先访问 `/` 换
  cookie 的跳转；上游 `?token` 在 `/` 上铸造 cookie 的形态不受影响。

**安全纪律：白名单只配平台自身的域名。** 命中白名单的 origin 上任何页面都
等于持有 agent 的完全控制权（读写会话、驱动轮次、消耗额度）——配置时按
"愿意把该 agent 交给此域名下任意页面运行"的标准权衡，不要配共享托管域名或
宽于实际使用的 origin。

session-sync v2 在此链路上把全量 journal 行（`session/event` 的行级 `rows`）
与按 turn 聚合的 usage（附于 `turn/end` 行）一并推送到 `ALLYBUILD_SESSION_URL`。
