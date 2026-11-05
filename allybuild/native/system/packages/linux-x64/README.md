# native/system 平台二进制（AllyBuild overlay 增补）

上游 `@deepseek-ai/node-addon-system-linux-x64` 的 npm 发布包含静态
Landlock 启动器 `bin/landlock-run`（dsh 沙箱 bash 工具的 Linux 第二
后端），但 **git 源码树不提交该构建产物**——源码构建的镜像里
`native/system/packages/linux-x64/bin/` 只有 `glibc/system.node`（flock
addon），launcher 缺失导致 `sandbox-local` 的 Landlock 探测恒 unusable，
agent bash 在 `workspace-write` 预设下直接拒绝执行。

本目录把 npm 包（0.1.2，与 harness checkout 的 workspace 版本一致）的
`bin/landlock-run` 以构建产物形式纳入 overlay，随 `rsync -a` 落到镜像内
`/dsh/native/system/packages/linux-x64/bin/landlock-run`——恰为
`launcherPath()` 的解析目标。

升级 harness 版本时须同步重取对应版本的平台包二进制（sha256 见
`bin/landlock-run.sha256`）。
