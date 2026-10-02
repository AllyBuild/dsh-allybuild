// @vitest-environment jsdom
// 冒烟：roster 全量进程内启动 + 种子 fixture 挂载不抛、wrapper 落 DOM、dispose 清理。
import { beforeAll, describe, expect, it } from 'vitest'
import { mountMirror } from '../src/mirror/mount.ts'

beforeAll(() => {
  // roster 的 UI 行依赖的浏览器 API，jsdom 缺省没有
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  })
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub })
  // jsdom 无 document.fonts（composer control-row 布局监听 loadingdone）
  Object.defineProperty(document, 'fonts', {
    writable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {} },
  })
  Element.prototype.scrollIntoView = () => {}
})

describe('mountMirror', () => {
  it('挂载种子会话并清理', { timeout: 30_000 }, async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const handle = mountMirror(host, {
      sessionId: 'task-smoke',
      createdAt: Date.now(),
      cwd: '/workspace',
      events: [
        { seq: 0, type: 'user/message', surfaceOp: 'append', time: Date.now(), data: { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } },
      ],
    })
    await handle.ready
    expect(host.querySelector('[data-dsh-mirror]')).not.toBeNull()
    await handle.dispose()
    expect(host.querySelector('[data-dsh-mirror]')).toBeNull()
    host.remove()
  })

  it('种子会话 composer slot 不崩（conversation service 可解析）', { timeout: 30_000 }, async () => {
    const errors: string[] = []
    const origError = console.error
    console.error = (...args: unknown[]) => {
      errors.push(args.map((a) => (a instanceof Error ? (a.stack ?? String(a)) : String(a))).join(' '))
    }
    try {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const handle = mountMirror(host, {
        sessionId: 'task-composer',
        createdAt: Date.now(),
        cwd: '/workspace',
        events: [
          { seq: 0, type: 'system/message', data: { message: { content: [{ type: 'text', text: 'sys' }] } } },
          { seq: 1, type: 'turn/start', data: { turn: 0 } },
          { seq: 2, type: 'user/message', data: { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] } },
          { seq: 3, type: 'assistant/message', data: { turn: 0, step: 0, message: { id: 'a0', content: [{ type: 'text', text: 'ans' }] } } },
          { seq: 4, type: 'turn/end', data: { turn: 0, reason: { kind: 'completed' } } },
        ],
      })
      await handle.ready
      await new Promise((r) => setTimeout(r, 500))
      await handle.dispose()
      host.remove()
      const crashed = errors.filter((e) => e.includes('conversation service unavailable')
        || e.includes('slot entry crashed'))
      if (crashed.length > 0) process.stdout.write(`\n=== SLOT CRASH ===\n${crashed.join('\n\n')}\n=== END ===\n`)
      expect(crashed).toEqual([])
    } finally {
      console.error = origError
    }
  })

  it('StrictMode 双挂载竞态：启动前 dispose 直接取消，不落任何 DOM', { timeout: 30_000 }, async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const handle = mountMirror(host, {
      sessionId: 'task-cancel', createdAt: Date.now(), events: [],
    })
    await handle.dispose() // 定时器尚未到期 → 取消挂载
    await new Promise((r) => setTimeout(r, 50))
    expect(host.querySelector('[data-dsh-mirror]')).toBeNull()
    await expect(handle.ready).resolves.toBeUndefined()
    host.remove()
  })
})
