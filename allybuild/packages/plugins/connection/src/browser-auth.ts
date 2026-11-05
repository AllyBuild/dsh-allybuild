/** AllyBuild overlay stub: the per-process browser authentication is
 * intentionally absent. The deployment sits behind the sandbox-level
 * Daytona auth — the preview URL auth key is the sandbox credential and
 * the only route to this server. Same exported shape as upstream so the
 * plugin, composition, and tests compile unchanged; every check admits. */

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
  authorizeIndex(_req: ConnectionIndexRequest, _res: ConnectionIndexResponse): boolean {
    return true
  }

  /** Every request that passed the Host/Origin fence is authenticated. */
  isAuthenticated(_req: ConnectionTrustRequest): boolean {
    return true
  }
}
