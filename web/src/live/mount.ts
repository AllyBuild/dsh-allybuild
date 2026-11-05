/**
 * 宿主挂载 live 面：真实传输（fetch/WS 钩子把相对路径前缀进 frame 反代）
 * + 完整 roster + session-focus 会话契约（ctx.effect 内打开，命名聚焦/缺省
 * 新建）。挂载/卸载机制与 mirror 相同（宏任务推迟 + 串行链，宿主
 * StrictMode 安全）。
 */
import { Context } from '@deepseek-ai/cordis'
import { installRoster, pkg } from '../shared/roster.ts'
import { focusSession } from '../shared/session-focus.ts'
import { bootUrl } from '../shared/frame-url.ts'
import { createSessionCatalogRpc } from './session-catalog.ts'
import { createWebConnectionRpc } from '../vendor/client-connection/src/client/rpc.ts'

export interface LiveMountOptions {
  readonly frameBase: string
  readonly token: string
  readonly agentId: string
  readonly sessionId?: string
  readonly workspacePath?: string
  /** 平台侧已知会话目录：session/list RPC 改由本地目录应答（省网关往返）。 */
  readonly sessionCatalog?: readonly { sessionId: string; title?: string; updatedAt?: number }[]
}

interface TransportGlobal {
  __DSH_TRANSPORT__?: { streamBaseUrl?: string }
}

export interface LiveHandle {
  readonly ready: Promise<void>
  dispose(): Promise<void>
}

const { installConnection } = pkg('@deepseek-ai/dsh-client-connection') as {
  installConnection: (ctx: Context, options: {
    transport: {
      fetch?: (input: string | URL, init: RequestInit) => Promise<Response>
      rpc?: unknown
    }
  }) => void
}

let mountChain: Promise<unknown> = Promise.resolve()
const MACROTASK_MS = 0

export function mountLive(container: HTMLElement, options: LiveMountOptions): LiveHandle {
  let disposed = false
  let teardown: (() => Promise<void>) | undefined
  let prevTransport: TransportGlobal['__DSH_TRANSPORT__']

  let markReady!: () => void
  let markFailed!: (reason: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve
    markFailed = reject
  })

  setTimeout(() => {
    if (disposed) { markReady(); return }
    const wsSeg = options.workspacePath ? `ws/${options.workspacePath}/` : ''
    const base = `${options.frameBase.replace(/\/+$/, '')}/${options.agentId}/${wsSeg}`
    // gateway 用 new URL(route, streamBaseUrl) 构造 WS 地址——基址必须绝对
    // （相对路径抛 Invalid base URL）；fetch 钩子仍拼相对 base 走 frame 反代。
    const streamBase = `${globalThis.location.origin}${base}`
    mountChain = mountChain
      .then(async () => {
        if (disposed) { markReady(); return }
        // 1) boot：冷启动拉起 + session 认领 + 种 cookie（同源，后续请求自动携带）
        const boot = await fetch(bootUrl(options.frameBase, options.agentId, {
          token: options.token,
          ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
          ...(options.workspacePath !== undefined ? { workspacePath: options.workspacePath } : {}),
        }), {
          headers: { accept: 'application/json' },
        })
        if (!boot.ok) {
          throw new Error(`live boot failed: HTTP ${boot.status}`)
        }
        if (disposed) { markReady(); return }
        // 2) 传输钩子：相对路径前缀进 frame 反代；gateway WS 经 streamBaseUrl 全局
        const g = globalThis as TransportGlobal
        prevTransport = g.__DSH_TRANSPORT__
        g.__DSH_TRANSPORT__ = { streamBaseUrl: streamBase }
        const ctx = new Context()
        // dsh 的 React root 与宿主 React 树分容器（同 mirror：宿主 StrictMode
        // 双挂载会清空外层容器子节点，共容器会撕裂 dsh root 的 DOM 归属）。
        const wrapper = document.createElement('div')
        wrapper.setAttribute('data-dsh-live', '')
        wrapper.style.display = 'contents'
        // 中途取消/失败都落到这里：ctx（含活连接）不泄漏、wrapper 不残留、
        // 传输钩子还原 prev（仍是我们设的值才动，避免覆盖后来的挂载）。
        const cleanup = async () => {
          await ctx.fiber.dispose().catch(() => undefined)
          if (g.__DSH_TRANSPORT__?.streamBaseUrl === streamBase) {
            g.__DSH_TRANSPORT__ = prevTransport
          }
          wrapper.remove()
        }
        try {
          installConnection(ctx, {
            transport: {
              // 会话目录本地应答：目录已在平台侧维护（抽屉传入），省去
              // shell 启动时对网关的 session/list 往返；其余 endpoint 由
              // 包装器透传网关 HTTP 载体（fetch 前缀进 frame 反代）。
              ...(options.sessionCatalog !== undefined
                ? {
                    rpc: createSessionCatalogRpc(
                      createWebConnectionRpc((input, init) => fetch(`${base}${String(input)}`, init)),
                      options.sessionCatalog,
                    ),
                  }
                : { fetch: (input, init) => fetch(`${base}${input}`, init) }),
            },
          })
          container.appendChild(wrapper)
          await installRoster(ctx)
          // 3) 会话契约导航：命名会话聚焦 / 默认工作区新建（与页面 boot 同语义）。
          //    服务必须在插件生命周期内取——裸 ctx.get 在生命周期外为 undefined，
          //    经 ctx.effect 等 catalog ready + 选中落定后再挂 UI（顺序照旧）。
          await focusSession(ctx, {
            sessionId: options.sessionId,
            workspacePath: options.workspacePath,
          })
          if (disposed) {
            await cleanup()
            markReady()
            return
          }
          // 同 mirror：renderer 挂载前等 conversation 服务（嵌套 Service 启动
          // 晚于外层插件 await，composer slot 首帧注入不重试）。
          await ctx.inject(['uiRenderer', 'conversation'], (scope) => {
            scope.effect(() => scope.uiRenderer.mount(wrapper), 'live: mount')
          })
          teardown = cleanup
          markReady()
        } catch (error) {
          await cleanup()
          markFailed(error)
        }
      })
      .catch(markFailed)
  }, MACROTASK_MS)

  return {
    ready,
    dispose: () => {
      disposed = true
      return new Promise<void>((finish) => {
        setTimeout(() => {
          // 挂载链在飞行中时等它落定再卸：teardown 后到（链尾才赋值）也一定执行；
          // 链已失败则 teardown 恒为 undefined，清理已在失败分支做过。
          const chain = mountChain.then(() => teardown?.())
          mountChain = chain.catch(() => undefined)
          chain.then(finish, finish)
        }, MACROTASK_MS)
      })
    },
  }
}
