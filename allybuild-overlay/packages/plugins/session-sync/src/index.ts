/**
 * Push session list metadata + journal rows to AllyBuild over HTTP.
 *
 * 宿主进程内事件驱动的会话同步：
 * - 元数据行（`sessions`）：事件增量（2s 防抖）的会话投影，同 v1；
 * - journal 行（`rows`）：`session/event` 的行级收集 `{sessionId, seq, type,
 *   data}`，增量 = 插件内存 seq 水位（`Map<sessionId, lastSeq>`，POST 成功
 *   才前移）——失败行留在 pending，由 2s 重试与后续事件补推（at-least-once，
 *   接收端按 (sessionId, seq) 幂等 upsert 去重）；
 * - `turn/end` 行即时直发（防抖例外，对齐 progress-sync 的 ask_user 先例）。
 *   journal 原生的 usage 挂在 `assistant/message` 的 `data.usage`（字段：
 *   inputTokens / cacheReadTokens / cacheWriteTokens / outputTokens，计数
 *   不相交），插件按 turn 聚合样本后附到 `turn/end` 行 `data.usage`（cache
 *   桶仅当该 turn 全部样本都报告，对齐 token-meter 聚合语义）。
 *
 * url/token/agentId 任一为空时自禁用。不做 boot 全量：web host 启动时恢复
 * 150+ 会话日志的重放会打满事件循环数十秒，饿死对话初始化（对话区永久空
 * 白）；监听器延迟 8s 注册避开恢复风暴，活跃会话的事件增量已覆盖使用面。
 * 插件重启的水位清零同样只影响监听注册后的新行——空窗期与存量行不重推。
 *
 * @module @deepseek-ai/dsh-allybuild-session-sync
 */

import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Composition entry. */
export interface Config {
  /** AllyBuild internal sync endpoint. */
  url: string
  /** HMAC-SHA256(agentId, JWT_SECRET) hex, issued by the driver. */
  token: string
  /** AllyBuild ProjectAgent id the payload is attributed to. */
  agentId: string
}

/** One wire row of the sync payload. */
export interface SessionSyncRow {
  id: string
  title?: string
  displayTitle: string
  cwd?: string
  parentId?: string
  origin?: string
  running: boolean
  completed: boolean
  blank: boolean
  updatedAt: number
}

/** One journal event row of the v2 push (接收端 upsert 键 = sessionId + seq). */
export interface JournalRow {
  sessionId: string
  seq: number
  type: string
  data: Record<string, unknown>
}

/** Usage face carried by `turn/end` rows (dsh TokenUsage 字段名，cache 桶可选). */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** One validated `assistant/message` `data.usage` sample. */
export type TurnUsageSample = TurnUsage

/**
 * Per-turn running total. `null` cache bucket = 至少一个样本未报告该桶
 * （token-meter 语义：仅当全部样本报告时该桶可用）。
 */
export interface TurnUsageState {
  samples: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Validate one `data.usage` shape; malformed samples are dropped whole. */
export function usageSampleOf(usage: unknown): TurnUsageSample | undefined {
  if (usage === null || typeof usage !== 'object') return undefined
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage as Record<string, unknown>
  const input = countOf(inputTokens)
  const output = countOf(outputTokens)
  if (input === undefined || output === undefined) return undefined
  const cacheRead = countOf(cacheReadTokens)
  const cacheWrite = countOf(cacheWriteTokens)
  if (cacheReadTokens !== undefined && cacheRead === undefined) return undefined
  if (cacheWriteTokens !== undefined && cacheWrite === undefined) return undefined
  return {
    inputTokens: input,
    outputTokens: output,
    ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
    ...cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite },
  }
}

export function initialTurnUsage(): TurnUsageState {
  return { samples: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function sumBucket(total: number | null, value: number | undefined): number | null {
  if (total === null || value === undefined) return null
  const sum = total + value
  return Number.isSafeInteger(sum) ? sum : null
}

export function addUsageSample(state: TurnUsageState, sample: TurnUsageSample): TurnUsageState {
  return {
    samples: state.samples + 1,
    inputTokens: state.inputTokens + sample.inputTokens,
    outputTokens: state.outputTokens + sample.outputTokens,
    cacheReadTokens: sumBucket(state.cacheReadTokens, sample.cacheReadTokens),
    cacheWriteTokens: sumBucket(state.cacheWriteTokens, sample.cacheWriteTokens),
  }
}

/** Terminal four-field usage; undefined when the turn had no valid sample. */
export function finalizeTurnUsage(state: TurnUsageState): TurnUsage | undefined {
  if (state.samples === 0) return undefined
  return {
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    ...state.cacheReadTokens === null ? {} : { cacheReadTokens: state.cacheReadTokens },
    ...state.cacheWriteTokens === null ? {} : { cacheWriteTokens: state.cacheWriteTokens },
  }
}

/** Minimal structural faces of host services this plugin touches. */
interface SyncSession {
  id: string
  seq: number
  header: {
    createdAt: number
    cwd?: string | undefined
    parentSession?: string | undefined
    origin?: string | undefined
  }
}

interface SyncSessionHeader {
  id: string
  createdAt: number
  cwd?: string | undefined
  parentSession?: string | undefined
  origin?: string | undefined
}

/** Raw harness session event (structural subset used for title/blank/时间/rows). */
export interface SyncEvent {
  type?: string
  seq?: number
  time?: number
  data?: Record<string, unknown> | undefined
}

type ProjectionValues = Record<string, unknown>

/** Human-facing label: durable title, cwd basename, then session id. */
export function displayTitleOf(title: unknown, cwd: unknown, id: string): string {
  if (typeof title === 'string' && title.trim()) return title
  if (typeof cwd === 'string' && cwd) {
    const base = cwd.split('/').filter(Boolean).pop()
    if (base) return base
  }
  return id
}

function titleRow(title: unknown): { title: string } | undefined {
  return typeof title === 'string' && title.trim() ? { title } : undefined
}

function headerFields(header: Omit<SyncSessionHeader, 'id'>): {
  cwd?: string
  parentId?: string
  origin?: string
} {
  return {
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(header.parentSession === undefined ? {} : { parentId: header.parentSession }),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
  }
}

/**
 * Derive a wire row from one session's committed events (live snapshot or
 * persisted log). 会话名 = 用户第一条输入（AllyBuild 语义）；harness 标题
 * 保存在 title 字段。blank/时间同样由 user/message 事件推导。
 */
export function truncateName(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= 60 ? flat : `${flat.slice(0, 60)}…`
}

function firstUserText(events: readonly SyncEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const content = (event.data ?? {}).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part !== null && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
        const text = (part as { text?: unknown }).text
        if (typeof text === 'string' && text.trim()) return text
      }
    }
  }
  return undefined
}

export function buildRowFromEvents(
  header: SyncSessionHeader,
  events: readonly SyncEvent[],
  agentStatus: string | undefined,
): SessionSyncRow {
  let title: unknown
  let firstPrompt: string | undefined
  let lastPromptAt = 0
  let hasPrompt = false
  for (const event of events) {
    if (event.type === 'session/title') {
      const candidate = (event.data ?? {}).title
      if (typeof candidate === 'string' && candidate.trim()) title = candidate
    }
    if (event.type === 'user/message') {
      if (firstPrompt === undefined) firstPrompt = firstUserText([event])
      hasPrompt = true
      if (typeof event.time === 'number' && event.time > lastPromptAt) lastPromptAt = event.time
    }
  }
  const displayTitle = firstPrompt !== undefined
    ? truncateName(firstPrompt)
    : displayTitleOf(title, header.cwd, header.id)
  return {
    id: header.id,
    ...titleRow(title),
    displayTitle,
    ...headerFields(header),
    running: agentStatus === 'running',
    completed: agentStatus === 'completed',
    blank: !hasPrompt,
    updatedAt: Math.max(header.createdAt, lastPromptAt),
  }
}

/** Project one attached (live) Session into a wire row from warm projections. */
export function buildSummary(
  session: SyncSession,
  values: ProjectionValues,
  agentStatus: string | undefined,
): SessionSyncRow {
  const title = values.title
  const metadata = values.sessionListMetadata as
    | { blank: boolean; lastPromptAt: number | null }
    | undefined
  const lastPromptAt = typeof metadata?.lastPromptAt === 'number' ? metadata.lastPromptAt : 0
  return {
    id: session.id,
    ...titleRow(title),
    displayTitle: displayTitleOf(title, session.header.cwd, session.id),
    ...headerFields(session.header),
    running: agentStatus === 'running',
    completed: agentStatus === 'completed',
    blank: metadata ? metadata.blank : session.seq === 0,
    updatedAt: Math.max(session.header.createdAt, lastPromptAt),
  }
}

/** Minimal structural face of the cordis host Context. */
interface SyncContext {
  inject(services: readonly string[], fn: (hostCtx: SyncContext) => void): void
  sessions: {
    list(): SyncSession[]
    get(id: string): SyncSession | undefined
  }
  agents: { get(id: string): { status?: string } | undefined }
  sessionProjections: {
    snapshot(session: SyncSession): { values: ProjectionValues }
    onChanged(listener: (session: SyncSession) => void): void
  }
  workspaceRegistry: { get archivedSessionIds(): readonly string[] }
  sessionQuery: {
    listSessions(signal?: AbortSignal): Promise<Array<{ header: SyncSessionHeader }>>
    readSession(
      sessionId: string,
    ): Promise<{ session: SyncSessionHeader; events: readonly SyncEvent[] }>
  }
  effect(execute: () => () => void, label: string): void
  on(event: string, listener: (session: SyncSession, event?: SyncEvent) => void): void
}

const DEBOUNCE_MS = 2000
/** web host 启动恢复风暴的避让窗口。 */
const LISTEN_DELAY_MS = 8000

export class AllybuildSessionSync extends Service {
  static Config: z<Config> = z.object({
    url: z.string().default(''),
    token: z.string().default(''),
    agentId: z.string().default(''),
  })

  constructor(ctx: SyncContext, config: Config) {
    super(ctx as never, 'allybuildSessionSync')
    if (!config.url || !config.token || !config.agentId) return

    // 宿主服务必须经 inject 声明后才能访问（cordis 强制约束）——全部同步
    // 机制都活在 inject 回调里，闭包一律用 hostCtx：外层 ctx 未授权，读
    // sessionProjections 会抛 "cannot get property without inject"。
    ctx.inject(['agents', 'sessionQuery', 'sessions', 'sessionProjections', 'workspaceRegistry'], (hostCtx) => {
      const post = (
        full: boolean,
        sessions: SessionSyncRow[],
        rows: JournalRow[],
        archived: readonly string[] = [],
      ): Promise<boolean> =>
        fetch(config.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({ agentId: config.agentId, full, sessions, archived, rows }),
          signal: AbortSignal.timeout(10_000),
        }).then(
          (resp) => {
            if (!resp.ok) {
              console.warn(`[allybuild-session-sync] POST ${resp.status}`)
              return false
            }
            return true
          },
          (reason: unknown) => {
            console.warn('[allybuild-session-sync] POST failed:', reason)
            return false
          },
        )

      const dirty = new Set<SyncSession>()
      /** sessionId → 未确认 journal 行（按 seq 升序）。 */
      const pendingRows = new Map<string, JournalRow[]>()
      /** sessionId → 已确认推送的最高 seq（仅 POST 成功后前移，断线补推的水位）。 */
      const watermark = new Map<string, number>()
      /** sessionId → 当前 turn 的 usage 累加桶（turn/start 开，turn/end 关）。 */
      const openTurnUsage = new Map<string, TurnUsageState>()
      let inflight = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const flush = (): void => {
        if (inflight) return
        let sessionRows: SessionSyncRow[] = []
        const journalRows: JournalRow[] = []
        try {
          for (const session of dirty) {
            const values = hostCtx.sessionProjections.snapshot(session).values
            const metadata = values.sessionListMetadata as
              | { blank: boolean; lastPromptAt: number | null }
              | undefined
            // blank 会话（壳自动建、无任何输入）不推元数据行——空会话洪水的源头
            if (metadata ? metadata.blank : session.seq === 0) continue
            sessionRows.push(buildSummary(session, values, hostCtx.agents.get(session.id)?.status))
          }
          for (const bucket of pendingRows.values()) journalRows.push(...bucket)
        } catch (error) {
          // 插件可能已在 flush 前被 dispose——宿主上下文已释放，只记警告。
          console.warn('[allybuild-session-sync] flush failed:', error)
          return
        }
        if (sessionRows.length === 0 && journalRows.length === 0) return
        const pushed = new Set(dirty)
        const acked = new Map<string, number>()
        for (const row of journalRows) {
          acked.set(row.sessionId, Math.max(acked.get(row.sessionId) ?? -1, row.seq))
        }
        inflight = true
        void post(false, sessionRows, journalRows).then((ok) => {
          inflight = false
          if (!ok) {
            // 断线补推：行与元数据原样留在 pending/dirty，2s 后重试。
            schedule()
            return
          }
          for (const [sessionId, seq] of acked) {
            watermark.set(sessionId, Math.max(watermark.get(sessionId) ?? -1, seq))
            const bucket = pendingRows.get(sessionId)
            if (bucket === undefined) continue
            const kept = bucket.filter(row => row.seq > seq)
            if (kept.length === 0) pendingRows.delete(sessionId)
            else pendingRows.set(sessionId, kept)
          }
          for (const session of pushed) dirty.delete(session)
          if (pendingRows.size > 0 || dirty.size > 0) schedule()
        })
      }

      const schedule = (): void => {
        if (timer !== undefined) return
        timer = setTimeout(() => {
          timer = undefined
          flush()
        }, DEBOUNCE_MS)
      }

      const markDirty = (session: SyncSession): void => {
        dirty.add(session)
        schedule()
      }
      hostCtx.effect(() => () => {
        if (timer !== undefined) clearTimeout(timer)
      }, 'allybuild-session-sync: timer')

      /**
       * 行级收集：水位与 pending 内去重后入槽。返回 true 表示该行是
       * turn/end（触发即时直发——它承载 turn 聚合 usage，记账等不起防抖）。
       */
      const collectRow = (session: SyncSession, event: SyncEvent): boolean => {
        const seq = typeof event.seq === 'number' ? event.seq : undefined
        if (seq === undefined || seq <= (watermark.get(session.id) ?? -1)) return false
        const bucket = pendingRows.get(session.id)
        if (bucket !== undefined && bucket.some(row => row.seq === seq)) return false
        const data: Record<string, unknown> = { ...(event.data ?? {}) }
        if (event.type === 'turn/start') {
          openTurnUsage.set(session.id, initialTurnUsage())
        } else if (event.type === 'assistant/message') {
          const state = openTurnUsage.get(session.id)
          const sample = usageSampleOf(data.usage)
          if (state !== undefined && sample !== undefined) {
            openTurnUsage.set(session.id, addUsageSample(state, sample))
          }
        } else if (event.type === 'turn/end') {
          const state = openTurnUsage.get(session.id)
          openTurnUsage.delete(session.id)
          const usage = state === undefined ? undefined : finalizeTurnUsage(state)
          if (usage !== undefined) data.usage = usage
        }
        const row: JournalRow = { sessionId: session.id, seq, type: event.type ?? 'unknown', data }
        if (bucket === undefined) pendingRows.set(session.id, [row])
        else bucket.push(row)
        return event.type === 'turn/end'
      }

      // web host 启动时恢复既存会话日志的重放会占用事件循环数十秒——
      // 监听器延迟注册，避开恢复风暴。
      const listenTimer = setTimeout(() => {
        hostCtx.on('session/created', session => markDirty(session))
        hostCtx.on('session/event', (session, event) => {
          markDirty(session)
          if (event !== undefined && collectRow(session, event)) flush()
        })
        hostCtx.sessionProjections.onChanged(session => markDirty(session))
        // 启动回填：监听只覆盖注册之后的事件——8s 窗口、插件重启（水位
        // 清零）、进程死亡丢 pending 都会造成镜像缺口。readSession 直接读
        // 持久化 journal（不依赖事件时点）全量补推；缺口可能位于水位之下
        // （早窗丢失），因此不过滤——接收端按 (sessionId, seq) 幂等去重，
        // 重复行无害。元数据行一并补（老会话列表不再缺行）。
        void (async () => {
          try {
            const headers = await hostCtx.sessionQuery.listSessions()
            for (const header of headers) {
              const { session, events } = await hostCtx.sessionQuery.readSession(header.id)
              const rows: JournalRow[] = []
              let hasPrompt = false
              let usageState = initialTurnUsage()
              for (const event of events) {
                if (event.type === 'user/message') hasPrompt = true
                const seq = typeof event.seq === 'number' ? event.seq : undefined
                if (seq === undefined) continue
                const data: Record<string, unknown> = { ...(event.data ?? {}) }
                if (event.type === 'turn/start') {
                  usageState = initialTurnUsage()
                } else if (event.type === 'assistant/message') {
                  const sample = usageSampleOf(data.usage)
                  if (sample !== undefined) {
                    usageState = addUsageSample(usageState, sample)
                  }
                } else if (event.type === 'turn/end') {
                  const usage = finalizeTurnUsage(usageState)
                  if (usage !== undefined) data.usage = usage
                  usageState = initialTurnUsage()
                }
                rows.push({
                  sessionId: header.id,
                  seq,
                  type: event.type ?? 'unknown',
                  data,
                })
              }
              const meta = buildRowFromEvents(
                session, events, hostCtx.agents.get(session.id)?.status,
              )
              if (rows.length > 0 || !meta.blank) {
                const ok = await post(false, [meta], rows)
                if (ok) {
                  const maxSeq = rows.length ? rows[rows.length - 1].seq : -1
                  watermark.set(header.id, Math.max(watermark.get(header.id) ?? -1, maxSeq))
                }
              }
            }
          } catch (error) {
            console.warn('[allybuild-session-sync] boot backfill failed:', error)
          }
        })()
      }, LISTEN_DELAY_MS)
      hostCtx.effect(() => () => clearTimeout(listenTimer), 'allybuild-session-sync: listen delay')
    })
  }
}

export default AllybuildSessionSync
