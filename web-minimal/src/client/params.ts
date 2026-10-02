/**
 * Boot-parameter parsing for the minimal surface. The page reads the query
 * string once at boot; everything it honors lives here so the contract stays
 * one function wide.
 */

/** Query parameters this surface honors at boot. */
export interface BootParams {
  /** Existing Session identity from `?session=`; validated by retain at use time. */
  readonly sessionId?: string
  /** Workspace directory from `?workspace=`; validated by the Host at use time. */
  readonly workspacePath?: string
}

/**
 * Parse the boot query string. Unknown keys are ignored; blank values count
 * as absent so a templated `?session=` placeholder boots the default flow.
 * Percent escapes decode via `URLSearchParams`; `+` is pre-encoded to `%2B`
 * first so it cannot decode as a form-data space — a filesystem path is not
 * form data.
 * @param search - the location search string (leading `?` optional).
 * @returns the recognized parameters, absent when unnamed or blank.
 */
export function parseBootQuery(search: string): BootParams {
  const query = new URLSearchParams(search.replace(/\+/g, '%2B'))
  const sessionId = query.get('session')
  const workspacePath = query.get('workspace')
  return {
    ...(sessionId !== null && sessionId !== '' ? { sessionId } : {}),
    ...(workspacePath !== null && workspacePath !== '' ? { workspacePath } : {}),
  }
}
