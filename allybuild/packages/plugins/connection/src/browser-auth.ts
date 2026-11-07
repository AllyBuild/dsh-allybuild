/** AllyBuild overlay stub: the per-process browser authentication is
 * intentionally absent. The deployment sits behind the sandbox-level
 * Daytona auth — the preview URL auth key is the sandbox credential and
 * the only route to this server. Same exported shape as upstream so the
 * plugin, composition, and tests compile unchanged; every check admits. */

import type { PeerId } from '@deepseek-ai/dsh-typert-protocol'
import { CONNECT_PATH, type ConnectionInteractions } from './connect-protocol.ts'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

export class BrowserAuth {
  private constructor(
    private readonly maxAgeMilliseconds: number,
  ) {
    if (!Number.isSafeInteger(this.maxAgeMilliseconds)
      || !Number.isSafeInteger(Date.now() + this.maxAgeMilliseconds)) {
      throw new Error('client-connection: cookieMaxAgeDays exceeds the safe timestamp range')
    }
  }

  /** No durable signing secret and no process token are needed without auth. */
  static async create(
    _processOwner: object,
    _credentials: unknown,
    maxAgeDays: number,
  ): Promise<BrowserAuth> {
    return new BrowserAuth(maxAgeDays * DAY_MILLISECONDS)
  }

  /** The clean URL is already the authenticated URL without browser auth. */
  authenticatedUrl(baseUrl: string): string {
    return baseUrl
  }

  /** Admit the index (and its token-exchange query, which nothing consumes). */
  authorizeIndex(_req: ConnectionIndexRequest, _res: ConnectionIndexResponse, _secure = false): boolean {
    return true
  }

  /** Publish the API operator and redirect, minus the cookie minting —
   * the operator rides the sandbox-level auth like every other request.
   * Non-GET or off-path requests stay refused, matching upstream. */
  authorizeConnect(
    req: ConnectionIndexRequest,
    res: ConnectionIndexResponse,
    _secure: boolean,
    publish: (interactions: ConnectionInteractions) => PeerId,
  ): void {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const declarations = url.searchParams.getAll('interactions')
    const interactions = declarations[0] ?? 'none'
    if (declarations.length > 1 || (interactions !== 'answer' && interactions !== 'none')) {
      res.writeHead(400, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      res.end('interactions must be declared once as answer or none\n')
      return
    }
    if (req.method !== 'GET' || url.pathname !== CONNECT_PATH) {
      res.writeHead(401, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
      return
    }
    publish(interactions)
    res.writeHead(302, { 'cache-control': 'no-store', 'location': './api/remote.mux' })
    res.end()
  }

  /** Every request that passed the Host/Origin fence is authenticated. */
  isAuthenticated(_req: ConnectionTrustRequest, _secure = false): boolean {
    return true
  }

  /** Unreachable behind the always-admitting browser check; the API
   * operator path carries no cookie to verify. */
  authenticateApi(_req: ConnectionTrustRequest, _secure = false): PeerId | undefined {
    return undefined
  }
}
