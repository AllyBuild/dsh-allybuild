/**
 * Task slot entry point — imports SDK workflow bindings, loads task_script.
 *
 * 平台交互面在 @allybuild/sdk（client/tasks/mcp/status/reporter/reactive）；
 * 本文件是沙箱 slot 的运行入口（与 task_script.ts 同目录上传），按
 * Convention 1（run）或 Convention 2（import 副作用）dispatch。后台服务
 * import 本文件获取 helpers 不会触发 runner（入口检测经 argv[1] 守卫）。
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AllyBuildClient,
  ScriptContext,
  TasksApi,
  McpApi,
  ProjectStatusProxy,
  fetchStatuses,
  HttpBackend,
  createReactive,
  defineStore,
} from '@allybuild/sdk'

// ── Injected context ────────────────────────────────────────────────────────
export const TASK_ID: string = process.env.TASK_ID ?? ''
export const PROJECT_ID: string = process.env.PROJECT_ID ?? ''
export const TASK_JWT: string = process.env.TASK_JWT ?? ''
export const ALLYBUILD_API_URL: string = process.env.ALLYBUILD_API_URL ?? ''
export const BG_SERVICE_ID: string = process.env.BG_SERVICE_ID ?? ''
export const SERVICE_WORKSPACE_ID: string = process.env.ALLYBUILD_WORKSPACE_ID ?? ''

export const params: Record<string, unknown> = (() => {
  try { return JSON.parse(process.env.TASK_PARAMS ?? '{}') } catch { return {} }
})()

export const project_tokens: Record<string, string> = (() => {
  try { return JSON.parse(process.env.ALLYBUILD_PROJECT_TOKENS ?? '{}') } catch { return {} }
})()

// ── SDK wiring ───────────────────────────────────────────────────────────────
export { defineStore, createReactive, HttpBackend }

const client = new AllyBuildClient(ALLYBUILD_API_URL, TASK_JWT, PROJECT_ID)

const _tasks = new TasksApi(client, {
  taskId: TASK_ID,
  bgServiceId: BG_SERVICE_ID,
  serviceWorkspaceId: SERVICE_WORKSPACE_ID,
} satisfies ScriptContext)
export const create_task = _tasks.createTask.bind(_tasks)
export const wait_task = _tasks.waitTask.bind(_tasks)
export const flush_tasks = _tasks.flushTasks.bind(_tasks)

const _mcp = new McpApi(client)
export const mcp = _mcp.mcp.bind(_mcp)
export const mcp_call = _mcp.mcpCall.bind(_mcp)

// ── Reporter ─────────────────────────────────────────────────────────────────
export interface Reporter {
  set_phase(phase: string): void
  set_progress(pct: number): void
}
export const reporter: Reporter = {
  set_phase(phase) { process.stdout.write(`[PHASE] ${phase}\n`) },
  set_progress(pct) { process.stdout.write(`[PROGRESS] ${pct}\n`) },
}

// ── project_status（Reactive ProjectStatusProxy）────────────────────────────
let _projectStatusRaw: Record<string, unknown> = {}
try {
  _projectStatusRaw = JSON.parse(process.env.ALLYBUILD_PROJECT_STATUS ?? '{}')
} catch { /* empty */ }

createReactive({ redis: new HttpBackend(ALLYBUILD_API_URL, TASK_JWT, PROJECT_ID) })
export const project_status = new ProjectStatusProxy(
  _projectStatusRaw, PROJECT_ID, defineStore)

const _statusFetchPromise = fetchStatuses(client).then(data => {
  for (const [k, v] of Object.entries(data)) {
    _projectStatusRaw[k] = v
  }
}).catch(() => { /* ignore */ })

// ── Runner（入口检测 → load task_script → dispatch）────────────────────────
// argv[1] 守卫：后台服务 import 本文件获取 helpers 时不触发 runner。
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
    await _statusFetchPromise
    const mod = await import('./task_script.ts')

    if (typeof mod.on_change === 'function' && params.trigger === 'on_change') {
      const ret = await mod.on_change(params.mutation ?? {}, params.state ?? {})
      if (ret !== undefined && ret !== null) {
        process.stdout.write(`[RESULT] ${JSON.stringify(ret)}\n`)
      }
    } else if (typeof mod.run === 'function') {
      const ret = await mod.run(params, reporter)
      if (ret !== undefined && ret !== null) {
        process.stdout.write(`[RESULT] ${JSON.stringify(ret)}\n`)
      }
    }
  })().catch((err: unknown) => {
    process.stderr.write((err instanceof Error ? err.stack ?? err.message : String(err)) + '\n')
    process.exit(1)
  })
}
