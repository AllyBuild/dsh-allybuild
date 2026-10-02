import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bundlePath = new URL('../lib/client.js', import.meta.url)

describe('client bundle artifact', () => {
  const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : undefined

  it('exists; run pnpm build first', () => {
    expect(bundle).toBeDefined()
  })

  it('registers through the module loader under the package id', () => {
    expect(bundle?.startsWith('window.__ModuleLoader__.load({ id: "dsh-web-minimal", factory: (require) => {'))
      .toBe(true)
    expect(bundle?.trimEnd().endsWith('return module.exports; } });')).toBe(true)
  })

  it('ships the boot navigation modules in one bundle', () => {
    expect(bundle).toContain('parseBootQuery')
    expect(bundle).toContain('navigateSession')
    expect(bundle).toContain('showBootErrorOverlay')
  })
})
