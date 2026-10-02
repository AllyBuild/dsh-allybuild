import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { dshVendorAlias } from './src/vendor-alias.ts'

export default defineConfig({
  resolve: {
    alias: dshVendorAlias.map(([find, replacement]) => ({ find, replacement: path.resolve(import.meta.dirname, replacement) })),
  },
  test: {
    environment: 'node',
    server: {
      deps: {
        // ESM 基线包携 CSS module 导入；默认外置走 Node 原生 ESM 会抛
        // "Unknown file extension .css"，须经 vite 转换内联。
        inline: [/@deepseek-ai[+/]dsh-client-ui-(primitives|dockkit)/],
      },
    },
  },
})
