import path from 'node:path'
import { defineConfig } from 'tsdown'
import { dshVendorAlias } from './src/vendor-alias.ts'

/** Module-table keys every dynamic browser bundle resolves at boot; mirrors the shell's PLATFORM_MODULES baseline. */
const BROWSER_BASELINE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

// CJS-only 包的 ESM shim：rolldown 内联 CJS 时对外部依赖的 require 在 ESM
// 产物里成为 __require 抛掷垫片（浏览器无 require），必须在解析期改道。
// use-sync-external-store/shim/with-selector 是 vendor 树内唯一实例
// （client-ui-renderer/src/client/bind.ts 消费）。
const shimAlias: Record<string, string> = {
  'use-sync-external-store/shim/with-selector': path.resolve(
    import.meta.dirname,
    'src/shim/use-sync-external-store.ts',
  ),
}

// vendored dsh 源码（src/vendor）整套闭包 alias——快照与 npm 0.1.7-rc.2 存在
// 导出面偏差，任何 dsh 包都不得残留走 npm 解析（混用会 MISSING_EXPORT 或
// 埋运行时地雷）。VENDOR_KEEP（cordis 家族）不在 alias 内，走 npm devDeps。
// rolldown 的 resolve.alias 是 Record（非 vite 的 {find,replacement} 数组）；
// 子路径键须先于包名键插入（生成的 tuple 列表已按 find 长度降序）。
const vendorAlias = {
  ...shimAlias,
  ...Object.fromEntries(
    dshVendorAlias.map(([find, replacement]) => [find, path.resolve(import.meta.dirname, replacement)]),
  ),
}
// client entry 的 module-table 基线包保持 external（specifier 不被重写）
const clientAlias = Object.fromEntries(
  Object.entries(vendorAlias)
    .filter(([find]) => !BROWSER_BASELINE.some(b => find === b || find.startsWith(b + '/'))),
)

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    // tsdown defaults to `.mjs` output for node builds; the manifest ships `.js`.
    fixedExtension: false,
    dts: false,
    external: [/^@deepseek-ai\//u],
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    external: [...BROWSER_BASELINE],
    alias: clientAlias,
    outputOptions: {
      entryFileNames: 'client.js',
    },
    // Rolldown re-prints `outputOptions.banner/intro/footer` through its code
    // generator, so tsdown's top-level `banner`/`footer` (emitted verbatim
    // after codegen) carry the module-loader registration; the intro's CJS
    // `module`/`exports` declarations join the banner inside the factory body.
    banner:
      'window.__ModuleLoader__.load({ id: "dsh-web-minimal", factory: (require) => {\n' +
      'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
  {
    // Embeddable React face for host systems; React stays a peer dependency.
    entry: { react: 'src/react/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'neutral',
    dts: false,
    external: ['react', 'react/jsx-runtime'],
    alias: vendorAlias,
    outputOptions: {
      entryFileNames: 'react.js',
    },
  },
  {
    // 离线镜像面：自包含产物——@deepseek-ai/*（含 peer 的 cordis）经
    // noExternal 强制内联（tsdown 默认会把 deps/peerDeps 外部化），仅
    // react 家族外部化。inlineDynamicImports 折叠 shiki 语法块等一切
    // 动态 chunk，保证单文件 mirror.js + mirror.css。
    entry: { mirror: 'src/mirror/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    dts: false,
    noExternal: [/^@deepseek-ai\//u],
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    alias: vendorAlias,
    outputOptions: {
      entryFileNames: 'mirror.js',
      inlineDynamicImports: true,
    },
    css: { fileName: 'mirror.css' },
  },
  {
    // 宿主挂载 live 面：同 mirror 自包含（@deepseek-ai/* 内联），react 家族
    // 外部化。上游 UI 样式与 mirror 同源（同 roster），经 live.css 独立产出，
    // 宿主 `import 'dsh-web-minimal/live.css'`。
    entry: { live: 'src/live/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    dts: false,
    noExternal: [/^@deepseek-ai\//u],
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    alias: vendorAlias,
    outputOptions: {
      entryFileNames: 'live.js',
      inlineDynamicImports: true,
    },
    css: { fileName: 'live.css' },
  },
])
