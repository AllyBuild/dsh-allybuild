// focusSession 单测：ctx.effect 内打开会话的契约——命名聚焦/未知拒绝/缺省
// 新建/settle 重试，语义对齐 navigateSession（真实 cordis 集成由
// mirror-mount.spec 冒烟覆盖）。
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { focusSession } from '../src/shared/session-focus.ts'

interface HarnessOptions {
  phase?: string
  byId?: Record<string, unknown>
  /** initializeDefault/create 返回 undefined（Host 拒绝默认工作区）。 */
  workspaceMissing?: boolean
  refreshError?: Error
}

function makeHarness(options: HarnessOptions = {}) {
  const state = {
    phase: options.phase ?? 'pending',
    byId: options.byId ?? {} as Record<string, unknown>,
  }
  const listeners = new Set<() => void>()
  const selection = { sessionId: undefined as string | undefined }
  const notify = (): void => {
    for (const fn of [...listeners]) fn()
  }
  const workspace = options.workspaceMissing === true ? undefined : { workspaceId: 'ws-default' }
  const services = {
    sessions: {
      refresh: options.refreshError === undefined
        ? vi.fn(async () => {})
        : vi.fn(async () => {
          throw options.refreshError
        }),
      create: vi.fn(async (input: { workspaceId: string }) => {
        const id = `created-${Object.keys(state.byId).length + 1}`
        state.byId[id] = { id }
        return id
      }),
      list: {
        getSnapshot: () => ({ phase: state.phase, byId: state.byId }),
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => {
            listeners.delete(fn)
          }
        },
      },
    },
    workspaces: {
      create: vi.fn(async () => workspace),
      initializeDefault: vi.fn(async () => workspace),
    },
    uiWorkspace: {
      openSession: vi.fn((target: string) => {
        selection.sessionId = target
        notify()
      }),
      selection: { getSnapshot: () => ({ sessionId: selection.sessionId }) },
    },
  }
  const cleanups: Array<() => void> = []
  const ctx = {
    get: (name: string) => services[name as keyof typeof services],
    effect: (execute: () => unknown) => {
      const cleanup = execute()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
      return {}
    },
  } as unknown as Context
  return { ctx, services, state, selection, cleanups }
}

describe('focusSession', () => {
  it('opens a named session once the catalog is ready and stops at selection settle', async () => {
    const h = makeHarness({ phase: 'ready', byId: { 'existing-7': { id: 'existing-7' } } })
    await focusSession(h.ctx, { sessionId: 'existing-7' })
    expect(h.services.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('existing-7')
    expect(h.services.sessions.refresh).not.toHaveBeenCalled()
    expect(h.services.sessions.create).not.toHaveBeenCalled()
    expect(h.services.workspaces.initializeDefault).not.toHaveBeenCalled()
  })

  it('rejects an unknown named session once the catalog is ready, without opening', async () => {
    const h = makeHarness({ phase: 'ready' })
    await expect(focusSession(h.ctx, { sessionId: 'ghost' })).rejects.toThrow('unknown session ghost')
    expect(h.services.uiWorkspace.openSession).not.toHaveBeenCalled()
    expect(h.services.sessions.create).not.toHaveBeenCalled()
  })

  it('retries while the catalog is pending, then opens the named session', async () => {
    const h = makeHarness()
    h.services.sessions.refresh.mockImplementation(async () => {
      h.state.phase = 'ready'
      h.state.byId['existing-7'] = { id: 'existing-7' }
    })
    await focusSession(h.ctx, { sessionId: 'existing-7' }, { settleAttempts: 3, settleDelayMs: 1 })
    expect(h.services.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('existing-7')
    expect(h.services.sessions.refresh.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('reports the catalog as unavailable when it never becomes ready', async () => {
    const h = makeHarness({ refreshError: new Error('transport not ready') })
    await expect(focusSession(h.ctx, { sessionId: 'existing-7' }, { settleAttempts: 2, settleDelayMs: 1 }))
      .rejects.toThrow('the session catalog did not settle: transport not ready')
    expect(h.services.uiWorkspace.openSession).not.toHaveBeenCalled()
  })

  it('creates a session in the default workspace when no session is named', async () => {
    const h = makeHarness({ phase: 'ready' })
    await focusSession(h.ctx, {})
    expect(h.services.workspaces.initializeDefault).toHaveBeenCalledExactlyOnceWith()
    expect(h.services.sessions.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws-default' })
    expect(h.services.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('created-1')
    expect(h.services.workspaces.create).not.toHaveBeenCalled()
  })

  it('creates the named workspace first when workspacePath is set', async () => {
    const h = makeHarness({ phase: 'ready', byId: {} })
    await focusSession(h.ctx, { workspacePath: '/w' })
    expect(h.services.workspaces.create).toHaveBeenCalledExactlyOnceWith({ path: '/w' })
    expect(h.services.workspaces.initializeDefault).not.toHaveBeenCalled()
    expect(h.services.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('created-1')
  })

  it('rejects when the host refuses a default workspace, without creating a session', async () => {
    const h = makeHarness({ phase: 'ready', workspaceMissing: true })
    await expect(focusSession(h.ctx, {})).rejects.toThrow('default workspace')
    expect(h.services.sessions.create).not.toHaveBeenCalled()
    expect(h.services.uiWorkspace.openSession).not.toHaveBeenCalled()
  })
})
