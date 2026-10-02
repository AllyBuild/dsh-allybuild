/**
 * 会话聚焦：目标会话经 `uiWorkspace.openSession` 打开，但 roster 启动默认
 * 选中空白会话（hero 空态），且 cordis 服务在插件生命周期外裸取 `ctx.get`
 * 为 undefined（提供方 fiber 非 ACTIVE 时严格 get 返回 undefined）。聚焦
 * 因此注册为 `ctx.effect`：订阅 sessions.list + settle 重试（refresh 兜底）
 * + 防重入宏任务，选中落定即停——mirror/mount.ts 的 reconcile 模式，两侧
 * 共享。
 *
 * - 命名 `sessionId`：catalog ready 且含该 id → 打开；ready 而缺该 id →
 *   拒绝（unknown session，同 navigateSession 契约）。
 * - 缺省：catalog ready 后初始化默认工作区（或建 `workspacePath` 命名工作
 *   区）+ 新建会话 + 打开（navigateSession 缺省分支同语义）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Default catalog-settling bounds: five attempts, 400 ms apart (navigateSession 同界). */
const SETTLE_ATTEMPTS = 5
const SETTLE_DELAY_MS = 400

export interface SessionFocusTarget {
  readonly sessionId?: string
  readonly workspacePath?: string
}

/** Catalog-settling bounds for the lookup; identical to navigateSession's. */
export interface SessionFocusOptions {
  /** Refresh attempts before giving up; the first refresh plus this many retries. */
  readonly settleAttempts?: number
  /** Delay between attempts, so a still-connecting transport can land. */
  readonly settleDelayMs?: number
}

type FocusSessions = Pick<ISessions, 'create' | 'list' | 'refresh'>
type FocusWorkspaces = Pick<IWorkspaces, 'create' | 'initializeDefault'>

/** `selection` 不在 UiWorkspace 公共接口上，与 mirror 同款防御式访问。 */
interface FocusUiWorkspace {
  openSession(target: string): void
  selection?: { getSnapshot(): { sessionId?: string } }
}

/**
 * Register the focus effect on the context; the returned promise settles once
 * the target session is selected (named session) or created and selected
 * (default flow). Rejects on an unknown named session, a refused workspace,
 * creation failure, or a catalog that never settles within bounds.
 */
export function focusSession(
  ctx: Context,
  target: SessionFocusTarget,
  options: SessionFocusOptions = {},
): Promise<void> {
  const namedId = target.sessionId
  const attempts = options.settleAttempts ?? SETTLE_ATTEMPTS
  const delayMs = options.settleDelayMs ?? SETTLE_DELAY_MS
  return new Promise<void>((resolve, reject) => {
    ctx.effect(() => {
      const sessions = ctx.get('sessions') as FocusSessions | undefined
      if (sessions === undefined) {
        reject(new Error('web-minimal: the session service did not activate'))
        return () => undefined
      }
      let done = false
      let failed = false
      let disposed = false
      let scheduled = false
      let creating = false
      let created: SessionId | undefined
      let refreshAttempts = 0
      let timer: ReturnType<typeof setTimeout> | undefined

      const finish = (): void => {
        if (done || failed) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const fail = (reason: unknown): void => {
        if (done || failed) return
        failed = true
        clearTimeout(timer)
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      }

      // openSession 会在列表订阅的通知链里同步再触发 reconcile——直接调用
      // 会无限递归（Maximum call stack）。发起动作全部经宏任务，且每 tick
      // 至多一次；选中落定后停止。
      const reconcile = (): void => {
        if (done || failed || scheduled) return
        const snap = sessions.list.getSnapshot()
        if (snap.phase !== 'ready') return
        const want = namedId ?? created
        if (want === undefined) {
          // 缺省路径：catalog 已 ready，拉起默认/命名工作区 + 新建会话。
          if (creating) return
          creating = true
          scheduled = true
          setTimeout(() => {
            scheduled = false
            if (done || failed || disposed) return
            void bootstrap().catch(fail)
          }, 0)
          return
        }
        if (snap.byId[want as SessionId] === undefined) {
          // 刚创建的会话行可能晚一拍到账；命名会话缺位则是终态拒绝。
          if (created !== undefined) return
          fail(new Error(`web-minimal: unknown session ${namedId}`))
          return
        }
        const ws = ctx.get('uiWorkspace') as FocusUiWorkspace | undefined
        if (ws === undefined || typeof ws.openSession !== 'function') return
        if (ws.selection?.getSnapshot().sessionId === want) {
          finish()
          return
        }
        scheduled = true
        setTimeout(() => {
          scheduled = false
          if (done || failed || disposed) return
          const s2 = sessions.list.getSnapshot()
          const w2 = ctx.get('uiWorkspace') as FocusUiWorkspace | undefined
          if (w2 === undefined || typeof w2.openSession !== 'function') return
          if (w2.selection?.getSnapshot().sessionId === want) {
            finish()
            return
          }
          if (s2.phase === 'ready' && s2.byId[want as SessionId] !== undefined) {
            w2.openSession(want)
          }
        }, 0)
      }

      // 缺省分支（语义对齐 navigateSession）：命名工作区或 Host 默认工作区
      // 内新建会话，再交给 openSession；resolve 等选中落定（reconcile）。
      const bootstrap = async (): Promise<void> => {
        const workspaces = ctx.get('workspaces') as FocusWorkspaces | undefined
        const ws = ctx.get('uiWorkspace') as FocusUiWorkspace | undefined
        if (workspaces === undefined || ws === undefined || typeof ws.openSession !== 'function') {
          throw new Error('web-minimal: the workspace services did not activate')
        }
        const workspace = target.workspacePath !== undefined
          ? await workspaces.create({ path: target.workspacePath })
          : await workspaces.initializeDefault()
        if (workspace === undefined) {
          throw new Error('web-minimal: the host did not return a default workspace')
        }
        const sessionId = await sessions.create({ workspaceId: workspace.workspaceId })
        created = sessionId
        ws.openSession(sessionId)
      }

      // settle 重试：传输未就绪时 catalog 停在 pending，订阅没有下一拍可等；
      // 显式 refresh 到 ready 或尝试耗尽（navigateSession 同界同文案）。
      const attemptRefresh = (): void => {
        if (done || failed || disposed) return
        if (sessions.list.getSnapshot().phase === 'ready') return
        if (refreshAttempts >= attempts) {
          fail(new Error('web-minimal: the session catalog did not settle'))
          return
        }
        refreshAttempts += 1
        sessions.refresh().then(() => {
          if (done || failed || disposed) return
          reconcile()
          timer = setTimeout(attemptRefresh, delayMs)
        }, (reason: unknown) => {
          if (done || failed || disposed) return
          if (sessions.list.getSnapshot().phase === 'ready') {
            reconcile()
            return
          }
          if (refreshAttempts >= attempts) {
            const detail = reason instanceof Error ? `: ${reason.message}` : ''
            fail(new Error(`web-minimal: the session catalog did not settle${detail}`))
            return
          }
          timer = setTimeout(attemptRefresh, delayMs)
        })
      }

      reconcile()
      const off = sessions.list.subscribe(reconcile)
      attemptRefresh()
      return () => {
        disposed = true
        clearTimeout(timer)
        off()
      }
    }, 'session: focus')
  })
}
