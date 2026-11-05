/** 浏览器版 node:module 替身（vendored Cordis Loader 的唯一 Node import）。 */
export const createRequire = (): never => {
  throw new Error('node:module is not available in the browser')
}
export type LoadHookContext = never
