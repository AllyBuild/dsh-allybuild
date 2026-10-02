// 回归：种子事件 → fixture RPC 的 session/follow 快照可打开。历史崩溃点：
// (1) assistant/message 不带 data.stream 时投影回扫抛 "stream is not iterable"；
// (2) 会话/日志物化后 list 阶段抛缺失字段。前端 mirror-fixture.test.ts 删除后，
// trajectory 合成事件形态的快照回放回归也归入本文件（synthesizedEvents）。
import { describe, expect, it } from 'vitest'
import { createFixtureFaces } from '../src/mirror/fixture.ts'

const CONTROLLER = new AbortController()

function fullTurnEvents(): Array<Record<string, unknown>> {
  const t0 = Date.now()
  return [
    { seq: 0, type: 'turn/start', time: t0, data: { turn: 0 } },
    {
      seq: 1, type: 'user/message', surfaceOp: 'append', time: t0 + 100,
      data: { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: '生成报告' }] },
    },
    { seq: 2, type: 'step/start', time: t0 + 200, data: { turn: 0, step: 0 } },
    {
      seq: 3, type: 'assistant/message', surfaceOp: 'append', time: t0 + 300,
      data: {
        turn: 0, step: 0,
        message: { id: 'a0', content: [{ type: 'text', text: '报告已生成' }] },
      },
    },
    { seq: 4, type: 'step/end', time: t0 + 400, data: { turn: 0, step: 0 } },
    { seq: 5, type: 'turn/end', time: t0 + 500, data: { turn: 0, reason: { kind: 'completed' } } },
  ]
}

async function snapshotEvents(
  sessionId: string,
  events: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const world = createFixtureFaces({
    mirror: [{ sessionId, createdAt: Date.now(), cwd: '/workspace', events }],
  })
  const open = world.rpc.open
  if (open === undefined) throw new Error('fixture rpc has no stream channel')
  const stream = open('/api', 'session/follow', {
    args: { request: { address: { kind: 'session', sessionId } } },
  }, CONTROLLER.signal)
  const frames: unknown[] = []
  for await (const frame of stream) {
    frames.push(frame)
    if ((frame as { type?: string }).type === 'snapshot') break
  }
  const snapshot = frames.find((f) => (f as { type?: string }).type === 'snapshot') as
    | { records?: Array<{ event: { type: string } }> }
    | undefined
  return (snapshot?.records ?? []).map((r) => r.event as Record<string, unknown>)
}

async function firstSnapshot(sessionId: string): Promise<Array<Record<string, unknown>>> {
  return snapshotEvents(sessionId, fullTurnEvents())
}

// eventsFromTrajectory（app/frontend/src/components/agentMirrorEvents.ts）对
// headless 任务轨迹的合成输出形态——append 面 surfaceOp、tool/call 与
// tool/result 按 source.callId 配对、<think> 拆 reasoning 块（原前端
// mirror-fixture.test.ts 的回归职责迁入；两处形态须保持一致）。
function synthesizedEvents(): Array<Record<string, unknown>> {
  const t0 = Date.now()
  return [
    {
      seq: 0, type: 'user/message', surfaceOp: 'append', time: t0,
      data: { id: 'syn-u-0', source: { kind: 'user' }, content: [{ type: 'text', text: '生成报告' }] },
    },
    { seq: 1, type: 'step/start', time: t0 + 100, data: { turn: 1, step: 1 } },
    {
      seq: 2, type: 'tool/call', time: t0 + 200,
      data: {
        callId: 'syn-call-2-0', name: 'write_file',
        arguments: '{"path":"/workspace/report.md"}', turn: 1, step: 1,
      },
    },
    {
      seq: 3, type: 'assistant/message', surfaceOp: 'append', time: t0 + 300,
      data: {
        turn: 1, step: 1,
        message: {
          id: 'syn-a-3',
          content: [
            { type: 'text', text: '开始生成' },
            { type: 'tool-call', name: 'write_file', arguments: '{"path":"/workspace/report.md"}' },
          ],
        },
      },
    },
    {
      seq: 4, type: 'tool/result', surfaceOp: 'append', time: t0 + 400,
      data: {
        message: {
          source: { callId: 'syn-call-2-0' },
          content: [
            { type: 'tool-result', content: [{ type: 'text', text: 'written 128 bytes' }], isError: false },
          ],
        },
      },
    },
    { seq: 5, type: 'step/start', time: t0 + 500, data: { turn: 1, step: 2 } },
    {
      seq: 6, type: 'assistant/message', surfaceOp: 'append', time: t0 + 600,
      data: {
        turn: 1, step: 2,
        message: {
          id: 'syn-a-6',
          content: [
            { type: 'reasoning', text: '用户要冷笑话，先想一个…' },
            { type: 'text', text: '报告已生成：/workspace/report.md' },
          ],
        },
      },
    },
  ]
}

describe('mirror fixture rpc', () => {
  it('session/follow 快照按种子事件原样回放', async () => {
    const events = await firstSnapshot('task-full-turn')
    expect(events.map((e) => e.type)).toEqual([
      'turn/start', 'user/message', 'step/start', 'assistant/message', 'step/end', 'turn/end',
    ])
  })

  it('无 stream/usage 的 assistant/message（真实 journal 镜像形态）同样可打开快照', async () => {
    // fullTurnEvents 的 assistant/message 本就不带 stream/usage——同一条链路即回归
    const events = await firstSnapshot('task-no-stream')
    expect(events.length).toBe(6)
  })

  it('trajectory 合成形态（tool/call 配对 + think→reasoning）整流回放不缺字段', async () => {
    const events = await snapshotEvents('task-synthesized', synthesizedEvents())
    expect(events.map((e) => e.type)).toEqual([
      'user/message', 'step/start', 'tool/call', 'assistant/message',
      'tool/result', 'step/start', 'assistant/message',
    ])
  })
})

describe('mirror fixture rpc：镜像行 surfaceOp 标记补全', () => {
  it('agent_dsh_messages 镜像行（仅 seq/type/data）按 append 补 surfaceOp、按会话头合成 time', async () => {
    const t0 = Date.now()
    const world = createFixtureFaces({
      mirror: [{
        sessionId: 'task-mirror-row', createdAt: t0, cwd: '/workspace',
        events: [
          { seq: 0, type: 'system/message', data: { message: { content: [{ type: 'text', text: 'sys' }] } } },
          { seq: 1, type: 'turn/start', data: { turn: 0 } },
          { seq: 2, type: 'user/message', data: { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] } },
        ] as Array<Record<string, unknown>>,
      }],
    })
    const open = world.rpc.open
    if (open === undefined) throw new Error('fixture rpc has no stream channel')
    const stream = open('/api', 'session/follow', {
      args: { request: { address: { kind: 'session', sessionId: 'task-mirror-row' } } },
    }, CONTROLLER.signal)
    const frames: unknown[] = []
    for await (const frame of stream) {
      frames.push(frame)
      if ((frame as { type?: string }).type === 'snapshot') break
    }
    const snapshot = frames.find((f) => (f as { type?: string }).type === 'snapshot') as
      | { records?: Array<{ event: Record<string, unknown> }> }
      | undefined
    const events = snapshot?.records?.map((r) => r.event) ?? []
    expect(events.find((e) => e.type === 'system/message')?.surfaceOp).toBe('append')
    expect(events.find((e) => e.type === 'user/message')?.surfaceOp).toBe('append')
    expect(events.find((e) => e.type === 'turn/start')?.surfaceOp).toBeUndefined()
    for (const e of events) {
      expect(typeof e.time).toBe('number')
    }
    expect(events.find((e) => e.type === 'user/message')?.time).toBe(t0 + 2)
  })
})

describe('mirror fixture rpc：rc.1 事件形态消毒', () => {
  it('request/header 携带 header.system 时剥离，follow 快照照常打开', async () => {
    const t0 = Date.now()
    const world = createFixtureFaces({
      mirror: [{
        sessionId: 'task-legacy-header',
        createdAt: t0,
        cwd: '/workspace',
        events: [
          {
            seq: 0, type: 'request/header', time: t0,
            data: { header: { system: 'legacy system prompt', tools: ['bash'], config: { provider: 'p', model: 'm' } } },
          },
          {
            seq: 1, type: 'user/message', surfaceOp: 'append', time: t0 + 10,
            data: { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
          },
        ] as Array<Record<string, unknown>>,
      }],
    })
    const open = world.rpc.open
    if (open === undefined) throw new Error('fixture rpc has no stream channel')
    const stream = open('/api', 'session/follow', {
      args: { request: { address: { kind: 'session', sessionId: 'task-legacy-header' } } },
    }, CONTROLLER.signal)
    const frames: unknown[] = []
    for await (const frame of stream) {
      frames.push(frame)
      if ((frame as { type?: string }).type === 'snapshot') break
    }
    const snapshot = frames.find((f) => (f as { type?: string }).type === 'snapshot') as
      | { records?: Array<{ event: Record<string, unknown> }> }
      | undefined
    const header = snapshot?.records?.[0]?.event as { data?: { header?: Record<string, unknown> } } | undefined
    expect(header?.data?.header).toBeDefined()
    expect(header?.data?.header).not.toHaveProperty('system')
    expect(header?.data?.header).toHaveProperty('tools')
  })
})

describe('mirror fixture rpc：assistant/message 无 stream 兜底', () => {
  it('data.stream 以空数组物化，快照原样回放', async () => {
    const t0 = Date.now()
    const world = createFixtureFaces({
      mirror: [{
        sessionId: 'task-no-stream2', createdAt: t0, cwd: '/workspace',
        events: [
          { seq: 0, type: 'user/message', surfaceOp: 'append', time: t0, data: { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] } },
          { seq: 1, type: 'assistant/message', surfaceOp: 'append', time: t0 + 5, data: { turn: 0, step: 0, message: { id: 'a0', content: [{ type: 'text', text: 'ans' }] } } },
        ] as Array<Record<string, unknown>>,
      }],
    })
    const open = world.rpc.open
    if (open === undefined) throw new Error('no stream channel')
    const stream = open('/api', 'session/follow', { args: { request: { address: { kind: 'session', sessionId: 'task-no-stream2' } } } }, CONTROLLER.signal)
    const frames: unknown[] = []
    for await (const f of stream) { frames.push(f); if ((f as { type?: string }).type === 'snapshot') break }
    const snap = frames.find((f) => (f as { type?: string }).type === 'snapshot') as { records?: Array<{ event: Record<string, unknown> }> } | undefined
    const assistant = snap?.records?.find((r) => r.event.type === 'assistant/message')?.event as { data?: { stream?: unknown[] } }
    expect(Array.isArray(assistant?.data?.stream)).toBe(true)
    expect((assistant?.data?.stream ?? []).length).toBe(0)
  })
})
