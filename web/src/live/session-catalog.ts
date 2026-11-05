// @ts-nocheck
/**
 * live 面的会话目录本地应答：员工抽屉已在平台侧维护会话列表
 * （agent_dsh_sessions，经 session-sync 落库），dsh 壳启动时的
 * session/list RPC 只为填充其内部目录（focusSession 的 byId 查找）——
 * 壳侧栏在嵌入模式下视觉隐藏，这只是一次为隐藏 UI 服务的网关往返。
 * 该 endpoint 从本地目录种子应答（wire 形态对齐 rc.2 的 session/list
 * 摘要），其余 endpoint 原样透传网关。
 */
import type { ClientConnectionRpc } from '../vendor/client-connection/src/rpc.ts'

/** 目录种子：平台侧已知的一条会话摘要。 */
export interface SessionCatalogEntry {
  readonly sessionId: string
  readonly title?: string
  readonly updatedAt?: number
}

export function createSessionCatalogRpc(
  inner: ClientConnectionRpc,
  entries: readonly SessionCatalogEntry[],
): ClientConnectionRpc {
  return {
    async call(channel, endpoint, payload, signal) {
      if (channel === '/api' && endpoint === 'session/list') {
        const items = [...entries]
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
          .map(e => ({
            sessionId: e.sessionId,
            title: e.title,
            cwd: '/workspace',
            running: false,
            blank: false,
            updatedAt: e.updatedAt ?? 0,
          }))
        return { ok: true, value: { items } }
      }
      return inner.call(channel, endpoint, payload, signal)
    },
  }
}
