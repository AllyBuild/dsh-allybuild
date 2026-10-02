import { useState } from 'react'
import type { FormEvent } from 'react'
import { DshChat } from 'dsh-web-minimal/react'

interface ConnectFormProps {
  host: string
  sessionId: string
  workspacePath: string
  onChange: (patch: Partial<{ host: string; sessionId: string; workspacePath: string }>) => void
  onConnect: () => void
}

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  flex: '1 1 180px',
}

const labelStyle = {
  font: '12px/1.4 system-ui, sans-serif',
  color: '#555',
}

const inputStyle = {
  font: '13px/1.4 system-ui, sans-serif',
  padding: '6px 8px',
  border: '1px solid #ccc',
  borderRadius: 6,
}

function ConnectForm({ host, sessionId, workspacePath, onChange, onConnect }: ConnectFormProps) {
  function submit(event: FormEvent) {
    event.preventDefault()
    onConnect()
  }

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'flex-end',
        padding: 16,
        borderBottom: '1px solid #eee',
      }}
    >
      <label style={fieldStyle}>
        <span style={labelStyle}>dsh host</span>
        <input
          style={inputStyle}
          value={host}
          onChange={(event) => onChange({ host: event.target.value })}
          placeholder="http://localhost:3080"
          required
        />
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>session id (optional)</span>
        <input
          style={inputStyle}
          value={sessionId}
          onChange={(event) => onChange({ sessionId: event.target.value })}
          placeholder="existing session"
        />
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>workspace path (optional)</span>
        <input
          style={inputStyle}
          value={workspacePath}
          onChange={(event) => onChange({ workspacePath: event.target.value })}
          placeholder="/workspace/project"
        />
      </label>
      <button
        type="submit"
        style={{
          font: '13px/1.4 system-ui, sans-serif',
          padding: '7px 16px',
          borderRadius: 6,
          border: '1px solid #2563eb',
          background: '#2563eb',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        Connect
      </button>
    </form>
  )
}

const DEFAULT_HOST = 'http://localhost:3080'

export function App() {
  const [host, setHost] = useState(DEFAULT_HOST)
  const [sessionId, setSessionId] = useState('')
  const [workspacePath, setWorkspacePath] = useState('')
  const [connected, setConnected] = useState(false)
  const [draft, setDraft] = useState({
    host: DEFAULT_HOST,
    sessionId: '',
    workspacePath: '',
  })

  if (!connected) {
    return (
      <ConnectForm
        host={draft.host}
        sessionId={draft.sessionId}
        workspacePath={draft.workspacePath}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onConnect={() => {
          setHost(draft.host)
          setSessionId(draft.sessionId)
          setWorkspacePath(draft.workspacePath)
          setConnected(true)
        }}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <ConnectForm
        host={draft.host}
        sessionId={draft.sessionId}
        workspacePath={draft.workspacePath}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onConnect={() => {
          setHost(draft.host)
          setSessionId(draft.sessionId)
          setWorkspacePath(draft.workspacePath)
        }}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        <DshChat
          host={host}
          sessionId={sessionId || undefined}
          workspacePath={workspacePath || undefined}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  )
}
