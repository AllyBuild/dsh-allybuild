// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { showBootErrorOverlay } from '../src/client/overlay.ts'

describe('showBootErrorOverlay', () => {
  it('appends one alert region carrying the message', () => {
    showBootErrorOverlay(document.body, 'boom')
    const overlay = document.querySelector('[data-dsh-web-minimal-boot-error]')
    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('role')).toBe('alert')
    expect(overlay?.firstChild?.textContent).toBe('boom')
    const retry = document.querySelector('a[data-dsh-web-minimal-boot-retry]')
    expect(retry).not.toBeNull()
    expect(retry?.textContent).toBe('Retry · 重试')
    expect(retry?.href).toBe(location.href)
  })

  it('replaces the message on a second failure instead of stacking overlays', () => {
    showBootErrorOverlay(document.body, 'first')
    showBootErrorOverlay(document.body, 'second')
    const overlays = document.querySelectorAll('[data-dsh-web-minimal-boot-error]')
    expect(overlays).toHaveLength(1)
    expect(overlays[0]?.firstChild?.textContent).toBe('second')
    const retries = document.querySelectorAll('a[data-dsh-web-minimal-boot-retry]')
    expect(retries).toHaveLength(1)
    expect(retries[0]?.href).toBe(location.href)
  })
})
