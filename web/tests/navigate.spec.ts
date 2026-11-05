import { vi, describe, expect, it, beforeEach } from 'vitest'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { navigateSession } from '../src/client/navigate.ts'

function workspaceView(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    workspaceId: 'ws-1',
    path: '/w',
    title: 'w',
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeServices() {
  const services = {
    sessions: {
      refresh: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue('created-1'),
      list: {
        getSnapshot: vi.fn().mockReturnValue({ phase: 'ready', items: [], byId: { 'existing-7': { sessionId: 'existing-7' } } }),
      },
    },
    workspaces: {
      create: vi.fn().mockResolvedValue(workspaceView()),
      initializeDefault: vi.fn().mockResolvedValue(workspaceView({ workspaceId: 'ws-default', path: '/default' })),
    },
    uiWorkspace: {
      openSession: vi.fn(),
    },
  }
  return services
}

let services: ReturnType<typeof makeServices>
beforeEach(() => {
  services = makeServices()
})

describe('navigateSession', () => {
  it('opens a named session after refreshing the catalog, creating nothing', async () => {
    await navigateSession(services, { sessionId: 'existing-7' })
    expect(services.sessions.refresh).toHaveBeenCalledOnce()
    expect(services.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('existing-7')
    expect(services.sessions.create).not.toHaveBeenCalled()
    expect(services.workspaces.create).not.toHaveBeenCalled()
    expect(services.workspaces.initializeDefault).not.toHaveBeenCalled()
  })

  it('creates the named workspace, then a session in it, then opens it', async () => {
    await navigateSession(services, { workspacePath: '/w' })
    expect(services.workspaces.create).toHaveBeenCalledWith({ path: '/w' })
    expect(services.sessions.create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(services.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('created-1')
    expect(services.workspaces.initializeDefault).not.toHaveBeenCalled()
  })

  it('initializes the default workspace without a request payload when no parameter names either target', async () => {
    await navigateSession(services, {})
    expect(services.workspaces.initializeDefault).toHaveBeenCalledExactlyOnceWith()
    expect(services.sessions.create).toHaveBeenCalledWith({ workspaceId: 'ws-default' })
    expect(services.uiWorkspace.openSession).toHaveBeenCalledWith('created-1')
    expect(services.workspaces.create).not.toHaveBeenCalled()
  })

  it('throws and opens nothing when the host refuses a default workspace', async () => {
    services.workspaces.initializeDefault.mockResolvedValue(undefined)
    await expect(navigateSession(services, {})).rejects.toThrow('default workspace')
    expect(services.sessions.create).not.toHaveBeenCalled()
    expect(services.uiWorkspace.openSession).not.toHaveBeenCalled()
  })

  it('propagates session-creation failure without opening a session', async () => {
    services.sessions.create.mockRejectedValue(new Error('workspace attach failed'))
    await expect(navigateSession(services, { workspacePath: '/w' })).rejects.toThrow('workspace attach failed')
    expect(services.uiWorkspace.openSession).not.toHaveBeenCalled()
  })

  it('propagates openSession failure for an unknown named session', async () => {
    services.uiWorkspace.openSession.mockImplementation(() => {
      throw new Error('sessions.retain: unknown session ghost')
    })
    await expect(navigateSession(services, { sessionId: 'ghost' })).rejects.toThrow('unknown session ghost')
    expect(services.sessions.create).not.toHaveBeenCalled()
  })

  it('rejects an unknown named session once the catalog is ready, since 0.1.7 openSession does not throw', async () => {
    await expect(navigateSession(services, { sessionId: 'ghost' })).rejects.toThrow('unknown session')
    expect(services.uiWorkspace.openSession).not.toHaveBeenCalled()
    expect(services.sessions.refresh).toHaveBeenCalledOnce()
  })

  it('retries while the catalog is still pending, then opens the named session', async () => {
    services.sessions.list.getSnapshot
      .mockReturnValueOnce({ phase: 'pending', ids: [], byId: {} })
      .mockReturnValue({ phase: 'ready', ids: ['existing-7'], byId: { 'existing-7': { sessionId: 'existing-7' } } })
    await navigateSession(services, { sessionId: 'existing-7' }, { settleAttempts: 3, settleDelayMs: 1 })
    expect(services.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('existing-7')
    expect(services.sessions.refresh.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('retries through a rejected refresh, then opens the named session', async () => {
    services.sessions.refresh.mockRejectedValueOnce(new Error('transport not ready'))
    await navigateSession(services, { sessionId: 'existing-7' }, { settleAttempts: 3, settleDelayMs: 1 })
    expect(services.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('existing-7')
  })

  it('reports the catalog as unavailable when it never becomes ready', async () => {
    services.sessions.list.getSnapshot.mockReturnValue({ phase: 'pending', ids: [], byId: {} })
    await expect(navigateSession(services, { sessionId: 'existing-7' }, { settleAttempts: 3, settleDelayMs: 1 }))
      .rejects.toThrow('session catalog')
    expect(services.uiWorkspace.openSession).not.toHaveBeenCalled()
  })
})
