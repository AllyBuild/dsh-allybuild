/**
 * live 构建产物断言：宿主可解析的 ./live 导出 + 自包含 bundle
 * （@deepseek-ai/* 内联）+ cordis $$typeof 补丁到位。组件冒烟经构建断言
 * 路线——仓库无 vitest-browser-react，不为此新增依赖。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bundlePath = new URL('../lib/live.js', import.meta.url)

describe('live bundle', () => {
  const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : undefined

  it('exports built; run pnpm build first', () => {
    expect(bundle).toBeDefined()
  })

  it('ships the live surface in one self-contained bundle', () => {
    expect(bundle).toContain('DshLiveChat')
    expect(bundle).toContain('mountLive')
  })

  it('inlines @deepseek-ai/* (no external imports)', () => {
    expect(bundle).not.toMatch(/from\s*"@deepseek-ai\//u)
  })

  it('carries the cordis $$typeof patch', () => {
    expect(bundle).toContain('prop.startsWith("$$")')
  })

  it('keeps the streamBaseUrl transport hook', () => {
    expect(bundle).toContain('streamBaseUrl')
  })
})

describe('package exports ./live', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, unknown>
  }

  it('resolves types and default to the built artifacts', () => {
    expect((pkg.exports['./live'] as { types: string; default: string }).default).toBe('./lib/live.js')
    expect((pkg.exports['./live'] as { types: string; default: string }).types).toBe('./lib/types/live/index.d.ts')
    expect(existsSync(new URL('../lib/types/live/index.d.ts', import.meta.url))).toBe(true)
  })

  it('resolves ./live.css to the built stylesheet', () => {
    expect(pkg.exports['./live.css']).toBe('./lib/live.css')
    expect(existsSync(new URL('../lib/live.css', import.meta.url))).toBe(true)
  })
})
