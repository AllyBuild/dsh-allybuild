/**
 * dsh-web-minimal browser half: read the boot query once, drive the session
 * navigation over the session/workspace clients, and surface any failure as
 * an alert overlay. The plugin registers no slots — the reduced roster's
 * conversation area renders the retained Session, and the empty state comes
 * from ui-conversation itself.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { navigateSession } from './navigate.ts'
import { showBootErrorOverlay } from './overlay.ts'
import { parseBootQuery } from './params.ts'

/** Services the boot navigation drives; activation waits for all of them. */
export const inject = ['sessions', 'workspaces', 'uiWorkspace', 'layout'] as const

/**
 * Read the boot query and retain or create the URL-named Session.
 * @param ctx - client context carrying the declared `sessions` and
 *   `workspaces` services.
 */
export function apply(ctx: Context): void {
  // 会话列表由宿主（AllyBuild drawer）承担：折叠空的左侧栏——ui-sidebar
  // 已从本表面的 roster 摘除，layout 仍渲染 rail（宽屏 280px；窄屏默认
  // 收成 darwin 零宽轨）。标记宿主形态为桌面（与 macOS Electron shell
  // 同语义）：折叠态的轨道整列消失。toggle 是双语义开关：宽屏翻宽度
  // （→0），窄屏（<1024）翻 narrowExpanded——后者默认已收起，再翻反而
  // 展开，故窄屏不调。
  document.documentElement.dataset.platform = 'darwin'
  // 表面内的会话面包屑行（titleRow）在宿主抽屉里纯冗余：会话名由左侧
  // 会话面板承载，顶栏已有 agent/模型/工作区。CSS modules 哈希保留语义
  // 后缀，用 [class*=] 稳定匹配。空态 headerSessionless 的 titleRow 是
  // 桌面拖拽带占位，抽屉场景同样无意义，一并隐藏。
  const killTitleRow = document.createElement('style')
  killTitleRow.textContent = '[class*="_titleRow"] { display: none !important; }'
  document.head.appendChild(killTitleRow)
  if (window.innerWidth >= 1024) ctx.layout.toggleSidebar()
  const params = parseBootQuery(globalThis.location.search)
  const zh = globalThis.navigator?.language?.toLowerCase().startsWith('zh') ?? false
  const heading = zh ? '无法打开会话' : 'Could not open the session'
  navigateSession(ctx, params).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    showBootErrorOverlay(document.body, `${heading}\n${detail}`)
  })
}
