// @ts-nocheck
// session/list 本地目录应答：员工抽屉的平台列表 → live 壳内部目录，
// 网关往返省略；其余 endpoint 透传。
import { describe, expect, it, vi } from 'vitest'
import { createSessionCatalogRpc } from '../src/live/session-catalog.ts'

describe('createSessionCatalogRpc', () => {
  it('session/list 返回按 updatedAt 降序的目录（wire 摘要形态）', async () => {
    const inner = { call: vi.fn(), }
    const rpc = createSessionCatalogRpc(inner, [
      { sessionId: 'task-a', title: '旧会话', updatedAt: 100 },
      { sessionId: 'task-b', updatedAt: 300 },
      { sessionId: 'task-c', title: '新会话', updatedAt: 200 },
    ])
    const result = await rpc.call('/api', 'session/list', { args: { request: {} } })
    expect(result.ok).toBe(true)
    expect(result.value.items).toEqual([
      { sessionId: 'task-b', title: undefined, cwd: '/workspace', running: false, blank: false, updatedAt: 300 },
      { sessionId: 'task-c', title: '新会话', cwd: '/workspace', running: false, blank: false, updatedAt: 200 },
      { sessionId: 'task-a', title: '旧会话', cwd: '/workspace', running: false, blank: false, updatedAt: 100 },
    ])
    expect(inner.call).not.toHaveBeenCalled()
  })

  it('其余 endpoint 原样透传 inner（含 channel 与 signal）', async () => {
    const inner = {
      call: vi.fn().mockResolvedValue({ ok: true, value: { sessionId: 's1' } }),
    }
    const rpc = createSessionCatalogRpc(inner, [])
    const signal = new AbortController().signal
    const result = await rpc.call('/api', 'session/history', { args: {} }, signal)
    expect(result).toEqual({ ok: true, value: { sessionId: 's1' } })
    expect(inner.call).toHaveBeenCalledWith('/api', 'session/history', { args: {} }, signal)
  })

  it('目录为空时返回空 items（focus 将按 unknown session 拒绝，不触网关）', async () => {
    const inner = { call: vi.fn() }
    const rpc = createSessionCatalogRpc(inner, [])
    const result = await rpc.call('/api', 'session/list', {})
    expect(result).toEqual({ ok: true, value: { items: [] } })
  })
})
