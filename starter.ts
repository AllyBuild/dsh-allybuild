/**
 * Task starter — script 模式任务的执行入口（与 Python 侧 runtime/starter.py 对齐）。
 *
 * 平台交互面（env 解析 + client 构建 + SDK 绑定）在
 * sdk/ts/src/workflow.ts，worker 上传到 slot 为 workflow.ts；本文件上传为
 * starter.ts 作入口：`import './workflow.ts'` 走自然模块解析，随后加载
 * task_script 并按 Convention 1（run）或 on_change dispatch。
 *
 * argv[1] 守卫：后台服务 import 本文件获取 helpers 时不触发 runner。
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { flush_tasks, params, reporter, statusPrefetch } from './workflow.ts'

const _isEntryPoint = (() => {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
})()

if (_isEntryPoint) {
  ;(async () => {
    // 状态预取完成后再跑用户脚本（fire-and-forget，失败静默）
    await statusPrefetch
    const mod = await import('./task_script.ts')

    if (typeof mod.on_change === 'function' && params.trigger === 'on_change') {
      // Reactive background service: on_change(mutation, state) mirrors the
      // reactive $subscribe callback contract. Takes precedence over run on
      // reactive triggers.
      const ret = await mod.on_change(params.mutation ?? {}, params.state ?? {})
      flush_tasks()
      if (ret !== undefined && ret !== null) {
        process.stdout.write(`[RESULT] ${JSON.stringify(ret)}\n`)
      }
    } else if (typeof mod.run === 'function') {
      const ret = await mod.run(params, reporter)
      flush_tasks()
      if (ret !== undefined && ret !== null) {
        process.stdout.write(`[RESULT] ${JSON.stringify(ret)}\n`)
      }
    }
  })().catch((err: unknown) => {
    process.stderr.write((err instanceof Error ? err.stack ?? err.message : String(err)) + '\n')
    process.exit(1)
  })
}
