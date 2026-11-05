/**
 * Embeddable React face of dsh-web-minimal: `<DshChat>` frames the whole
 * minimal chat surface — conversation and trajectory — as served by a running
 * dsh Host webserver. The component's whole product is the boot URL: it
 * serializes the same `?session=` / `?workspace=` contract the page parses at
 * boot, so a prop change reloads the frame and replays the URL contract
 * exactly like a manual refresh does.
 */
import type { CSSProperties } from 'react'

/** The boot query parameters the component can carry; blank means absent. */
export interface DshChatQuery {
  /** Existing Session identity; replays the `?session=` contract. */
  readonly sessionId?: string
  /** Workspace directory; replays the `?workspace=` contract. */
  readonly workspacePath?: string
}

/** Props for {@link DshChat}. */
export interface DshChatProps extends DshChatQuery {
  /** Absolute base URL of the dsh webserver, including any reverse-proxy path prefix; no query string. */
  readonly host: string
  /** Accessible frame title; assistive tech announces it. */
  readonly title?: string
  /** Wrapper element class; sizing is the embedder's concern. */
  readonly className?: string
  /** Wrapper element style; merged over the 100%-by-100% default. */
  readonly style?: CSSProperties
}

/**
 * Serialize the boot query onto the host base URL. Encoding mirrors
 * `parseBootQuery` exactly: blank values count as absent, and
 * `encodeURIComponent` keeps `+` literal (`%2B`) and spaces as `%20`, so a
 * filesystem path round-trips instead of decoding as form data.
 * @param host - absolute base URL; any existing query string is replaced.
 * @param params - the recognized parameters, absent when unnamed or blank.
 */
export function buildBootUrl(host: string, params: DshChatQuery): string {
  const url = new URL(host)
  url.search = [
    ...(params.sessionId ? [`session=${encodeURIComponent(params.sessionId)}`] : []),
    ...(params.workspacePath ? [`workspace=${encodeURIComponent(params.workspacePath)}`] : []),
  ].join('&')
  return url.toString()
}

/** Default accessible frame title. */
const DEFAULT_TITLE = 'DSH chat' as const

/**
 * The minimal chat surface, framed for embedding. The iframe fills the
 * wrapper; sizing and layout belong to the host system via `className` and
 * `style`. Changing any URL-bearing prop reloads the frame.
 */
export function DshChat({
  host,
  sessionId,
  workspacePath,
  title = DEFAULT_TITLE,
  className,
  style,
}: DshChatProps): React.JSX.Element {
  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <iframe
        src={buildBootUrl(host, { sessionId, workspacePath })}
        title={title}
        allow="clipboard-write"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  )
}
