/**
 * Boot navigation for the minimal surface. Since Harness 0.1.7 the main view
 * belongs to the `uiWorkspace` service: its `replaceMain` retains the Session
 * under the `mainView` source, and the conversation panel renders that
 * selection. This module's whole product is therefore: resolve the URL-named
 * target (existing session, URL-named workspace, or the Host default), then
 * hand it to `uiWorkspace.openSession`. Every failure propagates to the
 * caller's overlay; nothing is silently skipped.
 */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BootParams } from './params.ts'

/** Services the boot navigation drives; activation waits for all of them. */
export interface BootServices {
  readonly sessions: Pick<ISessions, 'refresh' | 'create' | 'list'>
  readonly workspaces: Pick<IWorkspaces, 'create' | 'initializeDefault'>
  readonly uiWorkspace: Pick<UiWorkspace, 'openSession'>
}

/** Catalog-settling bounds for the named-session lookup. */
export interface SettleOptions {
  /** Refresh attempts before giving up; the first refresh plus this many retries. */
  readonly settleAttempts?: number
  /** Delay between attempts, so a still-connecting transport can land. */
  readonly settleDelayMs?: number
}

/** Default catalog-settling bounds: five attempts, 400 ms apart. */
const SETTLE_ATTEMPTS = 5
const SETTLE_DELAY_MS = 400

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Verify one named Session exists in the Host catalog and return its id.
 * 0.1.7's `openSession` no longer throws synchronously for an unknown id, so
 * the URL contract's unknown-id overlay is enforced here. A refresh that
 * lands while the transport is still connecting leaves the catalog
 * `pending`; settle with bounded retries before deciding.
 * @throws `unknown session` once the catalog is ready without the id, or
 *   `session catalog` when the retries are exhausted without a ready catalog.
 */
async function resolveNamedSession(
  services: BootServices,
  sessionId: string,
  options: SettleOptions,
): Promise<SessionId> {
  const attempts = options.settleAttempts ?? SETTLE_ATTEMPTS
  const delayMs = options.settleDelayMs ?? SETTLE_DELAY_MS
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await delay(delayMs)
    try {
      await services.sessions.refresh()
    } catch (error) {
      lastError = error
      continue
    }
    const snapshot = services.sessions.list.getSnapshot()
    if (snapshot.byId[sessionId as SessionId] !== undefined) return sessionId as SessionId
    if (snapshot.phase === 'ready') {
      throw new Error(`web-minimal: unknown session ${sessionId}`)
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`web-minimal: the session catalog did not settle${detail}`)
}

/**
 * Run the boot navigation for one page load.
 *
 * - `?session=<id>`: verify the id against the settled Host catalog, then
 *   open it. An unknown id refuses with the caller's overlay.
 * - `?workspace=<path>`: create or reuse that workspace (the Host resolves
 *   an existing registration idempotently), create a session in it, open.
 * - no parameter: initialize (or reuse) the Host default workspace — the
 *   Host owns its naming since 0.1.7 — create a session in it, open.
 *
 * @param services - the session, workspace, and main-view client services.
 * @param params - the parsed boot query.
 * @param options - catalog-settling bounds for the named-session lookup.
 * @throws when the named session is unknown, the workspace cannot be
 *   resolved, or session creation fails; nothing is opened in those cases.
 * The opened reference is owned by the uiWorkspace main view: page lifetime
 * releases it, and unload tears the client down.
 */
export async function navigateSession(
  services: BootServices,
  params: BootParams,
  options: SettleOptions = {},
): Promise<void> {
  if (params.sessionId !== undefined) {
    const sessionId = await resolveNamedSession(services, params.sessionId, options)
    services.uiWorkspace.openSession(sessionId)
    return
  }
  const workspace = params.workspacePath !== undefined
    ? await services.workspaces.create({ path: params.workspacePath })
    : await services.workspaces.initializeDefault()
  if (workspace === undefined) {
    throw new Error('web-minimal: the host did not return a default workspace')
  }
  const sessionId = await services.sessions.create({ workspaceId: workspace.workspaceId })
  services.uiWorkspace.openSession(sessionId)
}
