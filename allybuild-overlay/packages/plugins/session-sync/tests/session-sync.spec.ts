import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addUsageSample,
  AllybuildSessionSync,
  buildRowFromEvents,
  buildSummary,
  displayTitleOf,
  finalizeTurnUsage,
  initialTurnUsage,
  usageSampleOf,
} from '../src/index.ts'

describe('displayTitleOf', () => {
  it('prefers title, then cwd basename, then id', () => {
    expect(displayTitleOf('我的会话', '/workspace', 's1')).toBe('我的会话')
    expect(displayTitleOf(undefined, '/workspace', 's1')).toBe('workspace')
    expect(displayTitleOf(undefined, undefined, 's1')).toBe('s1')
  })
})

describe('buildSummary', () => {
  const session = {
    id: 's1',
    seq: 0,
    header: { createdAt: 1000, cwd: '/workspace', parentSession: undefined, origin: undefined },
  }

  it('projects wire metadata from host state', () => {
    const summary = buildSummary(
      session,
      { title: 't', sessionListMetadata: { blank: false, lastPromptAt: 5000 } },
      'running',
    )
    expect(summary).toEqual({
      id: 's1', title: 't', displayTitle: 't', cwd: '/workspace',
      parentId: undefined, origin: undefined, running: true,
      completed: false, blank: false, updatedAt: 5000,
    })
  })

  it('marks completed off the agent status enum', () => {
    const summary = buildSummary(session, {}, 'completed')
    expect(summary).toEqual({
      id: 's1', displayTitle: 'workspace', cwd: '/workspace',
      parentId: undefined, origin: undefined, running: false,
      completed: true, blank: true, updatedAt: 1000,
    })
  })

  it('falls back to createdAt and seq for blank detection', () => {
    const summary = buildSummary(session, {}, undefined)
    expect(summary.updatedAt).toBe(1000)
    expect(summary.blank).toBe(true)
    expect(summary.running).toBe(false)
    expect(summary.title).toBeUndefined()
    expect(summary.displayTitle).toBe('workspace')
  })
})

describe('buildRowFromEvents', () => {
  const header = { id: 's9', createdAt: 1000, cwd: '/workspace' }

  it('derives title from the last session/title event', () => {
    const row = buildRowFromEvents(
      header,
      [
        { type: 'session/title', time: 2000, data: { title: '初稿' } },
        { type: 'user/message', time: 2500 },
        { type: 'session/title', time: 3000, data: { title: '定稿标题' } },
      ],
      undefined,
    )
    expect(row.title).toBe('定稿标题')
    expect(row.displayTitle).toBe('定稿标题')
    // updatedAt 取最后一条 user/message 时间，而非 title 事件时间
    expect(row.updatedAt).toBe(2500)
    expect(row.blank).toBe(false)
  })

  it('marks sessions without user/message as blank and falls back to cwd', () => {
    const row = buildRowFromEvents(
      header,
      [{ type: 'permission/preset', time: 1500 }, { type: 'approval/policy', time: 1600 }],
      'running',
    )
    expect(row.blank).toBe(true)
    expect(row.displayTitle).toBe('workspace')
    expect(row.running).toBe(true)
    expect(row.updatedAt).toBe(1000)
  })

  it('skips blank-title events and keeps earlier prompt time', () => {
    const row = buildRowFromEvents(header, [{ type: 'user/message', time: 4000 }], undefined)
    expect(row.title).toBeUndefined()
    expect(row.updatedAt).toBe(4000)
  })
})

describe('usageSampleOf', () => {
  it('accepts the four contract fields with optional cache buckets', () => {
    expect(usageSampleOf({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 2 }))
      .toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 2 })
    expect(usageSampleOf({ inputTokens: 10, outputTokens: 5 }))
      .toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('rejects malformed samples', () => {
    expect(usageSampleOf(undefined)).toBeUndefined()
    expect(usageSampleOf(null)).toBeUndefined()
    expect(usageSampleOf({ inputTokens: 10 })).toBeUndefined()
    expect(usageSampleOf({ inputTokens: -1, outputTokens: 5 })).toBeUndefined()
    expect(usageSampleOf({ inputTokens: 1.5, outputTokens: 5 })).toBeUndefined()
    expect(usageSampleOf({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 'x' })).toBeUndefined()
  })
})

describe('turn usage aggregation', () => {
  it('sums every sample and keeps cache buckets reported by all samples', () => {
    let state = initialTurnUsage()
    state = addUsageSample(state, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 })
    state = addUsageSample(state, { inputTokens: 30, outputTokens: 20, cacheReadTokens: 4 })
    expect(finalizeTurnUsage(state)).toEqual({ inputTokens: 130, outputTokens: 70, cacheReadTokens: 14 })
  })

  it('yields nothing for turns without any usage sample', () => {
    expect(finalizeTurnUsage(initialTurnUsage())).toBeUndefined()
  })
})

interface PostBody {
  agentId: string
  full: boolean
  sessions: unknown[]
  archived: unknown[]
  rows: Array<{ sessionId: string; seq: number; type: string; data: Record<string, unknown> }>
}

interface SessionFixture {
  id: string
  seq: number
  header: { createdAt: number; cwd?: string; parentSession?: string; origin?: string }
}

interface EventFixture {
  type: string
  seq: number
  time?: number
  data?: Record<string, unknown>
}

function fixtureSession(id: string): SessionFixture {
  return { id, seq: 0, header: { createdAt: 1000, cwd: '/workspace' } }
}

function startSync(
  sessionQuery?: {
    listSessions: () => Promise<Array<{ id: string; createdAt: number; cwd?: string }>>
    readSession: (id: string) => Promise<{
      session: { id: string; createdAt: number; cwd?: string }
      events: Array<EventFixture>
    }>
  },
) {
  const listeners = new Map<string, Array<(session: SessionFixture, event?: EventFixture) => void>>()
  const disposers: Array<() => void> = []
  const hostCtx = {
    sessions: { list: () => [] as SessionFixture[], get: (_id: string) => undefined },
    agents: { get: (_id: string) => undefined },
    sessionProjections: {
      snapshot: (_session: SessionFixture) => ({
        values: { sessionListMetadata: { blank: false, lastPromptAt: 42 } },
      }),
      onChanged: (_listener: (session: SessionFixture) => void) => {},
    },
    workspaceRegistry: { archivedSessionIds: [] as readonly string[] },
    sessionQuery: sessionQuery ?? {
      listSessions: async () => [] as Array<{ header: SessionFixture['header'] }>,
      readSession: async () => ({ session: { id: 'x', createdAt: 0 }, events: [] }),
    },
    effect: (execute: () => () => void) => {
      disposers.push(execute())
    },
    on: (event: string, listener: (session: SessionFixture, event?: EventFixture) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
  }
  const ctx = {
    reflect: { provide: () => {} },
    inject: (_services: readonly string[], fn: (host: typeof hostCtx) => void) => fn(hostCtx),
  }
  new AllybuildSessionSync(ctx as never, { url: 'http://allybuild/internal/session-sync', token: 'tk', agentId: 'ag1' })
  const fire = (session: SessionFixture, event: EventFixture): void => {
    session.seq = event.seq
    for (const listener of listeners.get('session/event') ?? []) listener(session, event)
  }
  return { fire, listens: () => listeners.has('session/event'), disposers }
}

describe('AllybuildSessionSync journal rows', () => {
  let fetchCalls: Array<{ url: string; body: PostBody }>

  const callAt = (i: number): { url: string; body: PostBody } => {
    const call = fetchCalls[i]
    if (call === undefined) throw new Error(`no POST call #${i}`)
    return call
  }
  const rowSeqs = (i: number): number[] => callAt(i).body.rows.map(r => r.seq)
  const rowAt = (i: number, j: number): PostBody['rows'][number] => {
    const row = callAt(i).body.rows[j]
    if (row === undefined) throw new Error(`no row #${j} in POST #${i}`)
    return row
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchCalls = []
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const stubFetch = (outcomes: Array<'ok' | 'fail'> = ['ok']): void => {
    const queue = [...outcomes]
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: { body: string }) => {
      fetchCalls.push({ url: url as string, body: JSON.parse(init.body) as PostBody })
      return { ok: (queue.shift() ?? 'ok') === 'ok' }
    }))
  }

  const registerListeners = (): void => {
    vi.advanceTimersByTime(8000)
  }

  it('pushes only rows past the acknowledged watermark', async () => {
    stubFetch(['ok', 'ok'])
    const { fire } = startSync()
    registerListeners()
    const s = fixtureSession('s1')
    fire(s, { type: 'user/message', seq: 1, time: 1, data: { content: [] } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(rowSeqs(0)).toEqual([1])
    fire(s, { type: 'tool/call', seq: 2, time: 2, data: { name: 'read' } })
    fire(s, { type: 'tool/result', seq: 3, time: 3, data: {} })
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchCalls.map((_c, i) => rowSeqs(i))).toEqual([[1], [2, 3]])
  })

  it('boot backfill heals pre-listener gaps and aggregates usage', async () => {
    // 8s 监听窗口之前发生的事件（seq 0-3）在镜像里缺失——启动回填应从
    // 持久化 journal 全量补推（含 turn usage 聚合与元数据行）。
    const persistedEvents: Array<EventFixture> = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 2, data: { content: [{ type: 'text', text: '早窗消息' }] } },
      {
        type: 'assistant/message', seq: 2, time: 3,
        data: { usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 1 } },
      },
      { type: 'turn/end', seq: 3, time: 4, data: { turn: 1 } },
    ]
    const sq = {
      listSessions: async () => [{ id: 's-old', createdAt: 1, cwd: '/workspace/snake' }],
      readSession: async (id: string) => ({
        session: { id, createdAt: 1, cwd: '/workspace/snake' },
        events: persistedEvents,
      }),
    }
    stubFetch(['ok'])
    startSync(sq)
    await vi.advanceTimersByTimeAsync(8000)
    await vi.runAllTimersAsync()
    const backfill = fetchCalls.find(c => c.body.rows.length > 0)
    expect(backfill).toBeDefined()
    expect(backfill!.body.rows.map(r => r.seq)).toEqual([0, 1, 2, 3])
    const turnEnd = backfill!.body.rows.find(r => r.type === 'turn/end')
    expect(turnEnd!.data.usage).toEqual({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 1 })
    expect(backfill!.body.sessions[0].blank).toBe(false)
    expect(backfill!.body.sessions[0].displayTitle).toBe('早窗消息')
  })

  it('sends the v2 payload shape', async () => {
    stubFetch(['ok'])
    const { fire } = startSync()
    registerListeners()
    fire(fixtureSession('s1'), { type: 'user/message', seq: 1, time: 1, data: { content: [] } })
    await vi.advanceTimersByTimeAsync(2000)
    const body = callAt(0).body
    expect(body.agentId).toBe('ag1')
    expect(body.full).toBe(false)
    expect(Array.isArray(body.sessions)).toBe(true)
    expect(body.archived).toEqual([])
    expect(body.rows).toEqual([
      { sessionId: 's1', seq: 1, type: 'user/message', data: { content: [] } },
    ])
  })

  it('fires turn/end rows immediately with aggregated usage', async () => {
    stubFetch(['ok'])
    const { fire } = startSync()
    registerListeners()
    const s = fixtureSession('s1')
    fire(s, { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } })
    fire(s, {
      type: 'assistant/message',
      seq: 2,
      time: 2,
      data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 } },
    })
    fire(s, { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'stop' } } })
    // 即时直发：不推进任何 timer，turn/end 落地当刻即已 POST
    expect(fetchCalls.length).toBe(1)
    expect(rowSeqs(0)).toEqual([1, 2, 3])
    expect(rowAt(0, 2).data.reason).toEqual({ kind: 'stop' })
    expect(rowAt(0, 2).data.usage).toEqual({ inputTokens: 100, cacheReadTokens: 10, cacheWriteTokens: 5, outputTokens: 50 })
    // 后续防抖 timer 触发不得重复推送
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchCalls.length).toBe(1)
  })

  it('omits usage when the turn reported no samples', async () => {
    stubFetch(['ok'])
    const { fire } = startSync()
    registerListeners()
    const s = fixtureSession('s1')
    fire(s, { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } })
    fire(s, { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'stop' } } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchCalls.length).toBe(1)
    expect(rowAt(0, 1).data.usage).toBeUndefined()
  })

  it('debounces non-terminal rows without immediate posts', async () => {
    stubFetch(['ok'])
    const { fire } = startSync()
    registerListeners()
    fire(fixtureSession('s1'), { type: 'user/message', seq: 1, time: 1, data: {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchCalls.length).toBe(0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchCalls.length).toBe(1)
  })

  it('re-pushes unacknowledged rows exactly once after a failed POST', async () => {
    stubFetch(['fail', 'ok', 'ok'])
    const { fire } = startSync()
    registerListeners()
    const s = fixtureSession('s1')
    fire(s, { type: 'user/message', seq: 1, time: 1, data: {} })
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchCalls.length).toBe(1)
    fire(s, { type: 'tool/call', seq: 2, time: 2, data: { name: 'read' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchCalls.length).toBe(2)
    expect(rowSeqs(1)).toEqual([1, 2])
    fire(s, { type: 'tool/result', seq: 3, time: 3, data: {} })
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchCalls.length).toBe(3)
    expect(rowSeqs(2)).toEqual([3])
  })

  it('ignores duplicate fires of the same event', async () => {
    stubFetch(['ok'])
    const { fire } = startSync()
    registerListeners()
    const s = fixtureSession('s1')
    const event: EventFixture = { type: 'user/message', seq: 1, time: 1, data: {} }
    fire(s, event)
    fire(s, event)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchCalls.length).toBe(1)
    expect(rowSeqs(0)).toEqual([1])
  })
})
