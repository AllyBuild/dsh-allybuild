"""Dockerfile dsh-src 段的两处源码编辑（本地复现用，逻辑与 Dockerfile 一致）。"""

# 1) tsconfig.host.json：把 AllyBuild 插件挂进 host 类型检查方案
path = "tsconfig.host.json"
text = open(path).read()
entries = ('"./packages/plugins/session-sync"', '"./packages/plugins/progress-sync"',
           '"./packages/plugins/answerer"')
anchor = '{ "path": "./packages/core/agent-default-model" },'
assert anchor in text, "tsconfig.host.json anchor missing"
for entry in entries:
    if entry not in text:
        text = text.replace(anchor, anchor + f'\n    {{ "path": {entry} }},', 1)
open(path, "w").write(text)

# 2) pnpm-workspace.yaml overrides：钉 micromark-util-types 到上游 lock 版本
path = "pnpm-workspace.yaml"
lines = open(path).read().splitlines(keepends=True)
needle = "overrides:\n"
assert needle in lines, "pnpm-workspace.yaml overrides anchor missing"
if not any("micromark-util-types" in line for line in lines):
    lines.insert(lines.index(needle) + 1, "  'micromark-util-types': '2.0.2'\n")
open(path, "w").writelines(lines)

print("edits ok:", all(e in text for e in entries))
