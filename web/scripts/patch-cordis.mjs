// 幂等补丁：npm cordis 的 ctx 代理对 React 19 dev 组件日志探测的
// $$ 前缀属性直接抛错（"cannot get property $$typeof without inject"），
// 掐断宿主 effects 链——任务详情抽屉整页冻结的根因之一。vendored 前端
// 对同一问题打过同款源码补丁（scripts/vendor-dsh.mjs apply_cordis_patch）；
// 此处把补丁打到内联 cordis 的自包含构建产物（lib/mirror.js、lib/live.js）。
import { readFileSync, writeFileSync } from 'node:fs'

const TARGETS = ['../lib/mirror.js', '../lib/live.js']
const MARKER = 'prop.startsWith("$$")'
const OLD =
  'return typeof prop === "symbol" || RESERVED_WORDS.includes(prop) || parseInt(prop).toString() === prop || prop.startsWith("_");'
const NEW =
  'return typeof prop === "symbol" || RESERVED_WORDS.includes(prop) || parseInt(prop).toString() === prop || prop.startsWith("_") || (typeof prop === "string" && prop.startsWith("$$"));'

let failed = false
for (const target of TARGETS) {
  const file = new URL(target, import.meta.url)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    console.error(`cordis patch: ${target} missing (build it first)`)
    failed = true
    continue
  }
  if (text.includes(MARKER)) {
    console.log(`cordis patch: already applied (${target})`)
    continue
  }
  if (!text.includes(OLD)) {
    console.error(`cordis patch: anchor not found in ${target} (upstream cordis shape changed?)`)
    failed = true
    continue
  }
  // 函数形态替换：字符串替换的 replacement 会把 $$ 解析为转义（→ 单个 $）
  writeFileSync(file, text.replaceAll(OLD, () => NEW))
  console.log(`cordis patch: applied (${target})`)
}
if (failed) process.exit(1)
