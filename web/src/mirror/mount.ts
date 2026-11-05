/**
 * 离线镜像挂载：cordis Context + 最小 roster（对话/轨迹表面，同服务页
 * cordis.patch.yml 的 browser 段裁剪：无 ui-sidebar/无宿主专属行），传输经
 * installConnection 的 rpc 钩子换成种子 fixture——不连任何容器。挂载/卸载
 * 走串行链，宿主 React StrictMode 双挂载下两次 mount/dispose 不竞争。
 */
import { Context } from '@deepseek-ai/cordis'
import { installRoster, pkg } from '../shared/roster.ts'
import { focusSession } from '../shared/session-focus.ts'
import { createFixtureConnectionRpc } from './fixture.ts'
import './mirror.css'

export interface MirrorSeed {
  readonly sessionId: string
  readonly createdAt: number
  readonly cwd?: string
  readonly events: ReadonlyArray<Record<string, unknown>>
}

const { installConnection } = pkg('@deepseek-ai/dsh-client-connection') as {
  installConnection: (ctx: Context, options: {
    transport: { rpc: unknown }
  }) => void
}

let mountChain: Promise<unknown> = Promise.resolve()

export interface MirrorHandle {
  /** 挂载完成（wrapper 已进 DOM）；失败 reject——错误占位消费。 */
  readonly ready: Promise<void>
  /** 卸载；启动前调用 = 取消挂载。幂等。 */
  dispose(): Promise<void>
}

/**
 * 宿主 effect 在 React 提交期内调用挂载/卸载：cordis renderer 内部走
 * ReactDOM.flushSync / root.unmount，在宿主渲染期同步执行会触发
 * "Should not already be working" 并摧毁 React 调度器（宿主整页冻结）。
 * 因此挂载与卸载的实际动作都推迟到宏任务——宿主的同步 flush 一定已经
 * 结束。handle 同步返回，dispose 可在挂载开始前到达（StrictMode 双挂载
 * 的清理竞态）直接取消。
 */
const _MACROTASK_MS = 0

export function mountMirror(container: HTMLElement, seed: MirrorSeed): MirrorHandle {
  let disposed = false
  let teardown: (() => Promise<void>) | undefined

  let markReady!: () => void
  let markFailed!: (reason: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve
    markFailed = reject
  })

  setTimeout(() => {
    if (disposed) {
      markReady()
      return
    }
    mountChain
      .then(async () => {
        if (disposed) {
          markReady()
          return
        }
        const ctx = new Context()
        installConnection(ctx, {
          transport: { rpc: createFixtureConnectionRpc({ mirror: [seed] }) },
        })
        // dsh 的 React root 与宿主 React 树分容器：宿主 StrictMode 双挂载会清空
        // 外层容器的子节点，共容器会撕裂 dsh root 的 DOM 归属。
        const wrapper = document.createElement('div')
        wrapper.setAttribute('data-dsh-mirror', '')
        wrapper.style.display = 'contents'
        container.appendChild(wrapper)
        await installRoster(ctx)
        // 聚焦种子会话：roster 启动默认选中空白会话（hero 空态），必须等
        // sessions 列表 ready 后经 uiWorkspace.openSession 打开目标——对齐
        // vendored boot.ts 的聚焦语义（选中落定即停，防空白会话竞态）。共享
        // session-focus 的 reconcile effect（与 live 同源；fixture 恒含种子，
        // 失败静默）。
        void focusSession(ctx, { sessionId: seed.sessionId }).catch(() => undefined)
        // composer 等 slot 首帧同步注入 conversation 服务；嵌套 Service 的
        // fiber 启动落定晚于外层 await ctx.plugin，不等它则 SlotErrorBoundary
        // 捕获一次即永久挂死（无重试）。上游 bootClient 以 loader.await()
        // 收敛全部 fiber，此处按依赖显式等待再挂 renderer。sessions 同理：
        // 输入框 lexicon 解析（InputHub）依赖 api-session-controller 提供的
        // sessions 服务。
        let unmountApp: (() => void) | undefined
        await ctx.inject(['uiRenderer', 'conversation', 'sessions'], (scope) => {
          scope.effect(() => {
            const disposeApp = scope.uiRenderer.mount(wrapper)
            const unmount = () => {
              if (unmountApp === undefined) return
              unmountApp = undefined
              disposeApp()
            }
            unmountApp = unmount
            return unmount
          }, 'mirror: mount')
        })
        teardown = async () => {
          // 先卸 React 树再收回服务：dispose 期间 lexical 的排队更新仍会
          // 打进 InputHub，服务已收回则抛 "sessions service unavailable"。
          unmountApp?.()
          await ctx.fiber.dispose()
          wrapper.remove()
        }
        markReady()
      })
      .catch(markFailed)
  }, _MACROTASK_MS)

  return {
    ready,
    dispose: () => {
      disposed = true
      return new Promise<void>((finish) => {
        setTimeout(() => {
          const chain = teardown ? mountChain.then(teardown) : Promise.resolve()
          mountChain = chain.catch(() => undefined)
          chain.then(finish, finish)
        }, _MACROTASK_MS)
      })
    },
  }
}
