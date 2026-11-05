// use-sync-external-store/shim/with-selector 的 ESM shim。
// npm 包是 CJS-only + NODE_ENV 分发器：rolldown 内联后其顶层 require('react')
// 在 ESM 产物里撞 __require 抛掷垫片（浏览器无 require），live/mirror 加载即炸。
// React 19 自带原生 useSyncExternalStore，本文件按上游参考实现（cjs/
// use-sync-external-store-shim/with-selector.development.js）逐语义移植，
// 是 vendor 树内唯一消费形态（client-ui-renderer/src/client/bind.ts）。
import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

function is(x: unknown, y: unknown): boolean {
  if (x === y) return x !== 0 || 1 / (x as number) === 1 / (y as number)
  return x !== x && y !== y
}

const objectIs: (a: unknown, b: unknown) => boolean =
  typeof Object.is === 'function' ? Object.is : is

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: (() => Snapshot) | undefined,
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  // Track the rendered snapshot.
  const instRef = useRef<{ hasValue: boolean; value: Selection | null } | null>(null)
  let inst = instRef.current
  if (inst === null) {
    inst = { hasValue: false, value: null }
    instRef.current = inst
  }

  const [getSelection, getServerSelection] = useMemo(() => {
    // Memoization state lives in closure locals of this memoized instance —
    // intentionally not a useRef, so concurrent copies keep separate caches.
    let hasMemo = false
    let memoizedSnapshot: Snapshot | undefined
    let memoizedSelection: Selection | undefined

    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true
        memoizedSnapshot = nextSnapshot
        const firstSelection = selector(nextSnapshot)
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value as Selection
          if (isEqual(currentSelection, firstSelection)) {
            memoizedSelection = currentSelection
            return currentSelection
          }
        }
        memoizedSelection = firstSelection
        return firstSelection
      }
      const prevSnapshot = memoizedSnapshot as Snapshot
      const prevSelection = memoizedSelection as Selection
      if (objectIs(prevSnapshot, nextSnapshot)) {
        return prevSelection
      }
      const nextSelection = selector(nextSnapshot)
      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
        return prevSelection
      }
      memoizedSnapshot = nextSnapshot
      memoizedSelection = nextSelection
      return nextSelection
    }

    const maybeGetServerSnapshot = getServerSnapshot === undefined ? null : getServerSnapshot
    const getSnapshotWithSelector = (): Selection => memoizedSelector(getSnapshot())
    const getServerSnapshotWithSelector =
      maybeGetServerSnapshot === null
        ? undefined
        : (): Selection => memoizedSelector(maybeGetServerSnapshot())
    return [getSnapshotWithSelector, getServerSnapshotWithSelector] as const
  }, [getSnapshot, getServerSnapshot, selector, isEqual])

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection)
  useEffect(() => {
    inst.hasValue = true
    inst.value = value
  }, [value])
  useDebugValue(value)
  return value
}
