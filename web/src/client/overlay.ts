/**
 * Fatal boot-navigation presentation. The minimal surface registers no slot,
 * so a navigation failure is shown as a fixed alert region over whatever the
 * frame rendered (the conversation empty state); a later call updates the
 * text instead of stacking overlays.
 */

/** Marker attribute identifying the overlay; doubles as the lookup key. */
const OVERLAY_MARKER = 'data-dsh-web-minimal-boot-error'

/** Fixed presentation shared by every overlay instance. */
const OVERLAY_STYLE = 'position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:2147483647;'
  + 'padding:0.75rem 1rem;border-radius:8px;background:#3b1d1d;color:#ffd7d7;'
  + 'font:13px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.35);white-space:pre-wrap;'

/** The retry affordance: reloading replays the boot URL contract exactly. */
const RETRY_LABEL = 'Retry · 重试'

/**
 * Show one fatal boot-navigation failure over the app frame.
 * @param container - the element the overlay attaches to (the document body).
 * @param message - complete, user-readable failure text; rendered verbatim.
 */
export function showBootErrorOverlay(container: HTMLElement, message: string): void {
  let overlay = container.querySelector<HTMLElement>(`[${OVERLAY_MARKER}]`)
  if (overlay === null) {
    overlay = document.createElement('div')
    overlay.setAttribute(OVERLAY_MARKER, '')
    overlay.setAttribute('role', 'alert')
    overlay.style.cssText = OVERLAY_STYLE
    container.appendChild(overlay)
  }
  overlay.textContent = message
  const retry = document.createElement('a')
  retry.setAttribute('data-dsh-web-minimal-boot-retry', '')
  retry.style.cssText = 'display:inline-block;margin-top:0.5em;color:#ffeded;'
  retry.textContent = RETRY_LABEL
  retry.href = globalThis.location.href
  overlay.appendChild(retry)
}
