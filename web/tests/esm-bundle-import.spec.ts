import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'vitest'

const run = promisify(execFile)

// 浏览器 ESM 没有 require：bundle 顶层若存在 CJS 内联的 require('react')
// （rolldown 对 CJS 内联外部依赖的 __require 垫片），加载即抛错。node ESM
// 同样没有 require（__require 回退为 Proxy 抛掷器），因此用 node ESM 子进程
// import 构建产物等价于浏览器冒烟——vitest 虽跑 node 但 vite-node 会注入
// require，这正是本回归此前逃过测试网的原因。
describe('built ESM bundles import without CJS require traps', () => {
  const preload = pathToFileURL(path.resolve(import.meta.dirname, 'fixtures/dom-globals.mjs')).href
  for (const bundle of ['lib/live.js', 'lib/mirror.js'] as const) {
    it(`${bundle} imports clean under node ESM`, async () => {
      const file = path.resolve(import.meta.dirname, '..', bundle)
      await run(process.execPath, [
        '--input-type=module',
        `--import=${preload}`,
        '--eval',
        `await import(${JSON.stringify(pathToFileURL(file).href)})`,
      ])
    })
  }
})
