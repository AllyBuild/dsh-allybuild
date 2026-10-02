/**
 * 宿主挂载 live React 组件：挂载选项变更即重挂（URL 契约式语义），卸载随
 * 组件生命周期 dispose。挂载失败渲染错误占位 + Retry（boot 长耗时且存在
 * 瞬态失败——冷启动、会话认领竞态、网关短暂不可达——重试走同一挂载路径，
 * 免去关抽屉重开）。尺寸由宿主经 className/style 控制，组件填满容器。
 * 上游 UI 样式由宿主经 `import 'dsh-web-minimal/live.css'` 引入。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { mountLive, type LiveHandle, type LiveMountOptions } from './mount.ts'

export type { LiveMountOptions }

export interface DshLiveChatProps extends LiveMountOptions {
  readonly className?: string
  readonly style?: CSSProperties
  /** Boot 窗口的加载指示；缺省用内置 spinner。宿主可传自己的组件（如 antd Spin）。 */
  readonly loadingIndicator?: ReactNode
}

export function DshLiveChat(props: DshLiveChatProps): React.JSX.Element {
  const { className, style, loadingIndicator, ...options } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retryCount, setRetryCount] = useState(0)
  const optionsKey = JSON.stringify(options)

  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    let cancelled = false
    setError('')
    setLoading(true)
    const handle = mountLive(el, JSON.parse(optionsKey) as LiveMountOptions)
    handle.ready
      .then(() => {
        if (!cancelled) setLoading(false)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setLoading(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
      void handle.dispose()
    }
  }, [optionsKey, retryCount])

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      {loading && (
        <div
          data-dsh-live-loading=""
          style={{
            position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
            background: 'var(--dsw-alias-bg-1, #fff)', zIndex: 2,
          }}
        >
          {loadingIndicator ?? (
            <span
              aria-label="loading"
              style={{
                width: 26, height: 26, borderRadius: '50%',
                border: '3px solid rgba(128,128,128,0.25)', borderTopColor: 'rgba(128,128,128,0.75)',
                animation: 'dsh-live-spin 0.8s linear infinite',
              }}
            />
          )}
          <style>{'@keyframes dsh-live-spin { to { transform: rotate(360deg) } }'}</style>
        </div>
      )}
      {error ? (
        <div
          data-dsh-live-error=""
          style={{
            position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
            padding: 24, color: '#e06c75', fontSize: 13, textAlign: 'center', gap: 12,
          }}
        >
          <span>live boot failed: {error}</span>
          <button
            type="button"
            onClick={() => setRetryCount((n) => n + 1)}
            style={{
              padding: '6px 16px', cursor: 'pointer', border: '1px solid #e06c75',
              borderRadius: 6, background: 'transparent', color: '#e06c75', fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  )
}
