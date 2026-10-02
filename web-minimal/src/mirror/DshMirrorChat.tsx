/**
 * 离线镜像 React 组件：种子变更即重挂（URL 契约式语义），卸载随组件
 * 生命周期 dispose。挂载失败渲染错误占位（不阻塞宿主其余 UI）。
 * 尺寸由宿主经 className/style 控制，组件填满容器。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { mountMirror, type MirrorHandle, type MirrorSeed } from './mount.ts'

export type { MirrorSeed }

export interface DshMirrorChatProps {
  /** 离线会话种子；变更触发整体重挂。 */
  readonly seed: MirrorSeed
  /** 容器 class；尺寸归宿主。 */
  readonly className?: string
  /** 覆盖默认 100%×100% 的样式。 */
  readonly style?: CSSProperties
}

export function DshMirrorChat({ seed, className, style }: DshMirrorChatProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    let cancelled = false
    setError('')
    const handle = mountMirror(el, seed)
    handle.ready.catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      cancelled = true
      void handle.dispose()
    }
  }, [seed])

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      {error ? (
        <div
          data-dsh-mirror-error=""
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            color: '#e06c75',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          mirror boot failed: {error}
        </div>
      ) : null}
    </div>
  )
}
