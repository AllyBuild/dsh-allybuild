// node ESM 子进程的浏览器等价全局环境：有 DOM、无 require。jsdom 提供
// document/window 族；jsdom 缺失的观察者类以最小 stub 补齐（模块作用域
// 探测够用，不承担渲染语义）。
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
// node 24 自带只读 navigator（getter-only），探针语义足够，跳过赋值
globalThis.location = dom.window.location
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.CustomEvent = dom.window.CustomEvent
globalThis.Event = dom.window.Event
globalThis.Element = dom.window.Element
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.matchMedia ??= (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false
  },
})
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
