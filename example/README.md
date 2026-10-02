# example:DshChat 对接 dsh-server

用 `dsh-web-minimal` 的 React 组件(`<DshChat>`)把一个运行中的 dsh-server
web 面嵌入任意宿主页面。`<DshChat>` 是一个 iframe 封装:`host` +
`sessionId`/`workspacePath` 经 `buildBootUrl` 序列化成最小面的
`?session=`/`?workspace=` boot 契约,任一 prop 变化即重载 iframe。

## 运行

```sh
# 1. 构建被引用的本地包(example 以 file:../web-minimal 引用其 lib/)
cd ../web-minimal && pnpm install && pnpm build && cd ../example

# 2. 启动 dev server
pnpm dev          # http://localhost:5173
```

Connect 表单里的 host 填一个 dsh webserver 的绝对基址,两种来源:

### 本地容器

```sh
docker build -t dsh-server ..
docker run -d --name dsh -p 3080:3080 -e DEEPSEEK_API_KEY=sk-... dsh-server
```

host 填 `http://localhost:3080`(默认值)。容器 overlay 关闭了浏览器认证
(部署形态位于沙箱级认证之后),本地 `-p` 映射即 authless。

### Daytona 沙箱

`daytona` 预览代理对**每个请求**校验 per-boot 鉴权
(`DAYTONA_SANDBOX_AUTH_KEY` 查询参数或 `X-Daytona-Preview-Token` 头),
浏览器 iframe 无法在其同源 `/api`、`/api/remote.mux` 请求上携带,预览域名
不能直接作为 embed 目标。用 SSH 隧道把沙盒内 dsh 映射到本机,host 仍填
`http://localhost:3080`:

```sh
pip install daytona-sdk
python3 -c "from daytona import Daytona, DaytonaConfig; \
  sb = Daytona(DaytonaConfig(api_key='dtn_...')).get('<sandbox-id>'); \
  print(sb.create_ssh_access().token)"
# 沙盒内 dsh 跑在 ALLYBUILD_DSH_PORT(缺省 3080)
ssh -N -L 3080:127.0.0.1:3080 <token>@ssh.app.daytona.io
```

隧道的 Host 头是 `localhost:3080`,在 dsh 信任栅栏的 loopback 豁免内,
跨站栅栏也不触发。

## 会话与工作区参数

`sessionId`/`workspacePath` 回放最小面的 `?session=`/`?workspace=` 契约,
仅当对端运行的 surface 解析该契约时生效。镜像默认 web profile 是完整 UI;
最小面作为独立 profile 部署(见 `../web-minimal/README.md`):
`dsh plugin --profile minimal add /dsh/web-minimal && dsh --profile minimal`。

## 已知限制

- 沙盒镜像 pin 的上游(`dsh-v0.1.7-rc.1`)与 vendored web-minimal 锚定的
  rc.2 client 之间存在版本差,混用组合层的 boot 日志会出现
  `shortcuts` 行 import 失败告警;独立部署时以同版本 client 为准。
- Daytona 沙盒由平台管理生命周期;平台侧闲置自停后需重新拉起并重建隧道
  (`create_ssh_access()` 的 token 每次调用都刷新)。
