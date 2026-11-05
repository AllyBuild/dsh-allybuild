/**
 * 进程内 dsh ModuleLoader 宿主。npm 包的 /client 入口是
 * window.__ModuleLoader__.load({id, factory}) 注册的经典脚本工厂（服务页
 * 由 dsh web host 以 <script> 依次求值）；这里以懒执行 CJS 语义复刻：
 * load 只注册 def，首次 require 时执行 factory 并缓存。react/cordis 家族
 * 不是 ModuleLoader 包，经本模块顶部静态 ESM import 同步供给。
 */
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as Cordis from '@deepseek-ai/cordis'
import * as DshClientStore from '@deepseek-ai/dsh-client-store'
import * as DshClientUiSlots from '@deepseek-ai/dsh-client-ui-slots'
import * as DshClientUiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as DshClientUiDockkit from '@deepseek-ai/dsh-client-ui-dockkit'

export interface ModuleDef {
  id: string
  factory: (require: (id: string) => unknown) => unknown
}

const defs = new Map<string, ModuleDef>()
const cache = new Map<string, unknown>()

/** npm /client 入口在 import 求值时即调用；本模块作为首个 import 求值时自装。 */
export function installModuleLoader(): void {
  const g = globalThis as { __ModuleLoader__?: { load(def: ModuleDef): void } }
  if (g.__ModuleLoader__ === undefined) {
    g.__ModuleLoader__ = { load(def) { defs.set(normalize(def.id), def) } }
  }
}

// ESM 的 import 求值先于任何 body 语句：client-modules.ts 里"先调用再
// import 包"不可行，装载只能作为本模块（首个 import）求值的一部分发生。
installModuleLoader()

// vendored /client 源码入口是纯 ESM 插件面（{ inject, apply }），没有 npm
// dist 那层 __ModuleLoader__.load 自注册副作用——由 client-modules.ts 以
// 命名空间导入后显式注册；factory 直接回传命名空间（模块求值已完成）。
// 仅含 default 的命名空间（如 shortcuts 的插件类）解包成 default 本体，
// 对齐 npm dist CJS 的 module.exports 形状（cordis 直接消费类/对象）。
export function registerModules(modules: ReadonlyArray<readonly [string, unknown]>): void {
  for (const [id, entry] of modules) {
    const ns = entry as Record<string, unknown>
    const keys = Object.keys(ns)
    const exports = keys.length === 1 && keys[0] === 'default' ? ns.default : ns
    defs.set(normalize(id), { id, factory: () => exports })
  }
}

const EXTERNALS: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': ReactJsxRuntime,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  '@deepseek-ai/cordis': Cordis,
  '@deepseek-ai/dsh-client-store': DshClientStore,
  '@deepseek-ai/dsh-client-ui-slots': DshClientUiSlots,
  '@deepseek-ai/dsh-client-ui-primitives': DshClientUiPrimitives,
  '@deepseek-ai/dsh-client-ui-dockkit': DshClientUiDockkit,
}

function normalize(id: string): string {
  // 仅 dsh 系包以 /client 后缀互引（注册名是裸包名）；react-dom/client
  // 等真实子路径不能剥。
  return id.startsWith('@deepseek-ai/') ? id.replace(/\/client$/u, '') : id
}

export function requireModule(id: string): unknown {
  if (id.endsWith('.css')) return {} // 上游包不携 css require；兜底防断
  const key = normalize(id)
  if (EXTERNALS[key] !== undefined) return EXTERNALS[key]
  if (cache.has(key)) return cache.get(key)
  const def = defs.get(key)
  if (def === undefined) throw new Error(`dsh module not registered: ${key}`)
  const exports = def.factory(requireModule)
  cache.set(key, exports)
  return exports
}
