/**
 * Push task-session progress to AllyBuild over HTTP.
 *
 * 任务会话（`task-{uuid}`）的 durable 事件 → 结构化进度快照：
 * - `todo/write`（dsh-tool-todo 整表快照，last-write-wins）为主源——
 *   completed/total 可算百分比，in_progress 项即当前步骤；
 * - `tool/call` / `turn/start` 为无 todo 时的粗粒度阶段。
 *
 * POST 到 AllyBuild 内部端点（HMAC token，与 session-sync 同一凭据派生），
 * 后端负责 i18n 文案、current_phase/progress 落库与 SSE 广播——插件只
 * 上报结构化数据，不产文案。每会话去抖 800ms 只保留最新快照；
 * boot 恢复风暴避让同 session-sync。ask_user_question 链路是例外：
 * `tool/call` 即时直发（kind=ask_user，后端据此转待反馈）；
 * `tool/result`（经 callId 回查工具名）即时直发（kind=ask_answered，
 * 问题被浏览器直答、轮次恢复，后端据此回 running）。
 *
 * @module @deepseek-ai/dsh-allybuild-progress-sync
 */

import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Composition entry. */
export interface Config {
  /** AllyBuild internal progress endpoint. */
  url: string
  /** HMAC-SHA256(agentId, JWT_SECRET) hex, issued by the driver. */
  token: string
  /** AllyBuild ProjectAgent id the payload is attributed to. */
  agentId: string
}

/** One todo entry as logged by `todo/write` (dsh-tool-todo 的 TodoItem). */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** One wire row:最新进度快照（backend composes phase label & percent）。 */
export interface ProgressRow {
  sessionId: string
  seq: number
  /** `todo/write` 的整表快照；非 todo 事件缺省。 */
  todos?: TodoItem[]
  /** 粗粒度阶段：turn_start / tool_call；ask_user / ask_answered 为
   *  提问链路专用即时行（转待反馈 / 浏览器直答后续跑）。 */
  kind?: 'turn_start' | 'tool_call' | 'ask_user' | 'ask_answered'
  /** Tool name for kind === 'tool_call'. */
  name?: string
}

/** Durable harness event (structural subset). */
export interface ProgressEvent {
  type?: string
  seq?: number
  data?: {
    todos?: unknown
    name?: unknown
    /** tool/call 的调用 id，tool/result 经它回查工具名。 */
    callId?: unknown
    /** tool/result 的 model-facing 结果消息（携带 toolCallId）。 */
    message?: { toolCallId?: unknown }
  }
}

function todoListOf(raw: unknown): TodoItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const todos: TodoItem[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') return undefined
    const { content, status } = item as { content?: unknown; status?: unknown }
    if (typeof content !== 'string' || !content.trim()) return undefined
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return undefined
    todos.push({ content: content.trim(), status })
  }
  return todos
}

/** Map one durable event to a progress row; undefined = not progress-worthy. */
export function rowOf(sessionId: string, event: ProgressEvent): ProgressRow | undefined {
  const seq = typeof event.seq === 'number' ? event.seq : -1
  if (event.type === 'todo/write') {
    const todos = todoListOf(event.data?.todos)
    if (todos === undefined) return undefined
    return { sessionId, seq, todos }
  }
  if (event.type === 'turn/start') return { sessionId, seq, kind: 'turn_start' }
  if (event.type === 'tool/call') {
    const name = event.data?.name
    return {
      sessionId,
      seq,
      kind: 'tool_call',
      ...(typeof name === 'string' && name ? { name } : {}),
    }
  }
  return undefined
}

/** Minimal structural face of the cordis host Context. */
interface SyncContext {
  effect(execute: () => () => void, label: string): void
  on(event: 'session/event', listener: (session: { id: string }, event: ProgressEvent) => void): void
}

const DEBOUNCE_MS = 800
/** web host 启动恢复风暴的避让窗口（与 session-sync 同参）。 */
const LISTEN_DELAY_MS = 8000

const TASK_PREFIX = 'task-'
/** 交互提问工具（dsh-tool-ask-user 注册名）：调用即任务转待反馈。 */
const ASK_USER_TOOL = 'ask_user_question'

export class AllybuildProgressSync extends Service {
  static Config: z<Config> = z.object({
    url: z.string().default(''),
    token: z.string().default(''),
    agentId: z.string().default(''),
  })

  constructor(ctx: SyncContext, config: Config) {
    super(ctx as never, 'allybuildProgressSync')
    if (!config.url || !config.token || !config.agentId) return

    const post = (rows: ProgressRow[]): void => {
      void fetch(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ agentId: config.agentId, updates: rows }),
        signal: AbortSignal.timeout(10_000),
      }).then(
        (resp) => {
          if (!resp.ok) console.warn(`[allybuild-progress-sync] POST ${resp.status}`)
        },
        (reason: unknown) => {
          console.warn('[allybuild-progress-sync] POST failed:', reason)
        },
      )
    }

    // sessionId → 最新待推快照：todo 快照与粗粒度事件同槽竞争，seq 新者胜
    //（current_phase/progress 只关心最新状态，中间态无消费方）。
    const pending = new Map<string, ProgressRow>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        try {
          if (pending.size === 0) return
          post([...pending.values()])
          pending.clear()
        } catch (error) {
          console.warn('[allybuild-progress-sync] flush failed:', error)
        }
      }, DEBOUNCE_MS)
    }
    ctx.effect(() => () => {
      if (timer !== undefined) clearTimeout(timer)
    }, 'allybuild-progress-sync: timer')

    // 延迟注册：boot 恢复既存任务会话日志的重放会瞬时打爆监听器。
    const listenTimer = setTimeout(() => {
      // tool/call 的 callId → 工具名：tool/result 事件本体不带名字，靠它
      // 识别 ask_user_question 的结果（= 问题已被浏览器直答，轮次恢复）。
      const callNames = new Map<string, string>()
      ctx.on('session/event', (session, event) => {
        if (!session.id.startsWith(TASK_PREFIX)) return
        // ask-user 即时直发，不入去抖槽：去抖按 session 只保留最新行，
        // ask_user 行可能被后续事件覆盖掉——而它是任务转待反馈的唯一信号。
        if (event.type === 'tool/call') {
          const callId = event.data?.callId
          if (typeof callId === 'string' && callId) {
            callNames.set(callId, typeof event.data?.name === 'string' ? event.data.name : '')
            if (callNames.size > 500) {
              const oldest = callNames.keys().next().value
              if (oldest !== undefined) callNames.delete(oldest)
            }
          }
          if (event.data?.name === ASK_USER_TOOL) {
            post([{ sessionId: session.id, seq: typeof event.seq === 'number' ? event.seq : -1, kind: 'ask_user' }])
            return
          }
        }
        if (event.type === 'tool/result') {
          const callId = event.data?.message?.toolCallId
          // 上游 rc.2 起 toolCallId 是 unknown：先收窄，Map 键类型才成立
          if (typeof callId !== 'string') return
          const name = callNames.get(callId)
          if (name === undefined) return
          callNames.delete(callId)
          if (name === ASK_USER_TOOL) {
            post([{ sessionId: session.id, seq: typeof event.seq === 'number' ? event.seq : -1, kind: 'ask_answered' }])
            return
          }
        }
        const row = rowOf(session.id, event)
        if (row === undefined) return
        const prev = pending.get(session.id)
        if (prev === undefined || row.seq >= prev.seq) pending.set(session.id, row)
        schedule()
      })
    }, LISTEN_DELAY_MS)
    ctx.effect(() => () => clearTimeout(listenTimer), 'allybuild-progress-sync: listen delay')
  }
}

export default AllybuildProgressSync
