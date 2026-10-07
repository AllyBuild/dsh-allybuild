/** web-minimal 最小 roster：顺序对齐前端 vendored boot.ts（connection 前置由调用方替代）。 */
import '../mirror/client-modules.ts'
import { requireModule } from '../mirror/loader.ts'
import type { Context } from '@deepseek-ai/cordis'

type CordisPlugin = { inject: string[]; apply(ctx: Context): void }

export function pkg(id: string): Record<string, unknown> {
  return requireModule(id) as Record<string, unknown>
}

export const ROSTER: ReadonlyArray<readonly [string, unknown]> = [
  ['typert-registry', pkg('@deepseek-ai/dsh-typert-registry')],
  ['api-gateway', pkg('@deepseek-ai/dsh-api-gateway')],
  ['api-session-controller', pkg('@deepseek-ai/dsh-api-session-controller')],
  ['api-workspace-controller', pkg('@deepseek-ai/dsh-api-workspace-controller')],
  ['file-upload', pkg('@deepseek-ai/dsh-client-file-upload')],
  ['api-remotes', pkg('@deepseek-ai/dsh-api-remotes')],
  ['cordis-client-runner', pkg('@deepseek-ai/dsh-cordis-client-runner')],
  ['locale', pkg('@deepseek-ai/dsh-client-locale')],
  ['shortcuts', pkg('@deepseek-ai/dsh-client-shortcuts')],
  ['ui-theme', pkg('@deepseek-ai/dsh-client-ui-theme')],
  ['ui-layout', pkg('@deepseek-ai/dsh-client-ui-layout')],
  ['ui-renderer', pkg('@deepseek-ai/dsh-client-ui-renderer')],
  ['ui-session', pkg('@deepseek-ai/dsh-client-ui-session')],
  ['resources', pkg('@deepseek-ai/dsh-client-resources')],
  ['ui-conversation', pkg('@deepseek-ai/dsh-client-ui-conversation')],
  ['ui-approval', pkg('@deepseek-ai/dsh-client-ui-approval')],
  ['ui-chat', pkg('@deepseek-ai/dsh-client-ui-chat')],
  ['ui-deliverables', pkg('@deepseek-ai/dsh-client-ui-deliverables')],
  ['ui-tool', pkg('@deepseek-ai/dsh-client-ui-tool')],
  ['ui-trajectory', pkg('@deepseek-ai/dsh-client-ui-trajectory')],
  ['ui-user-questions', pkg('@deepseek-ai/dsh-client-ui-user-questions')],
  ['ui-workspace', pkg('@deepseek-ai/dsh-client-ui-workspace')],
  ['ui-settings', pkg('@deepseek-ai/dsh-client-ui-settings')],
  ['ui-sidebar-right', pkg('@deepseek-ai/dsh-client-ui-sidebar-right')],
  ['ui-input-trigger', pkg('@deepseek-ai/dsh-client-ui-input-trigger')],
  ['ui-commands', pkg('@deepseek-ai/dsh-client-ui-commands')],
  ['ui-reference', pkg('@deepseek-ai/dsh-client-ui-reference')],
] as const

/** 按序安装 roster（live 与 mirror 共用：挂载循环收敛一处）。 */
export async function installRoster(ctx: Context): Promise<void> {
  for (const [, plugin] of ROSTER) {
    await ctx.plugin(plugin as CordisPlugin)
  }
}
