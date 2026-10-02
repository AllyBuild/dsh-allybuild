/** frame 代理路径助手：同源代理（dev vite / 生产同域反代）下的 URL 拼装。 */

function trimBase(frameBase: string): string {
  return frameBase.replace(/\/+$/, '')
}

/** frame 反代下的资源/WS 路径；rest 形如 `api/xxx`（可空=根）。 */
export function frameUrl(frameBase: string, agentId: string, rest: string, wsId?: string | null): string {
  const base = `${trimBase(frameBase)}/${agentId}`
  return rest === '' ? `${base}/` : wsId ? `${base}/ws/${wsId}/${rest}` : `${base}/${rest}`
}

/** boot 端点：冷启动 + session 认领 + 种 cookie（一次 GET 完成）。 */
export function bootUrl(
  frameBase: string,
  agentId: string,
  q: { token: string; sessionId?: string; workspacePath?: string },
): string {
  const search = [
    `token=${encodeURIComponent(q.token)}`,
    ...(q.sessionId ? [`session=${encodeURIComponent(q.sessionId)}`] : []),
    ...(q.workspacePath ? [`ws=${encodeURIComponent(q.workspacePath)}`] : []),
  ].join('&')
  return `${trimBase(frameBase)}/${agentId}/boot?${search}`
}
