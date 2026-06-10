import { useEffect, useState } from 'react'
import { Globe, Play, ChevronLeft, Loader2 } from 'lucide-react'
import { api } from '../api'
import { RunnerSessionView, StatusBadge } from './RunnerSessionView'
import type { AuditSession, RunnerRunResponse, RunnerSession, SessionListItem } from '../types'

function mkAudit(task: string, startUrl?: string): AuditSession {
  return {
    id: crypto.randomUUID(),
    title: task.slice(0, 60) + (task.length > 60 ? '…' : ''),
    task,
    startUrl,
    status: 'running',
    startedAt: Date.now(),
  }
}

// ── Session list item ─────────────────────────────────────────────────────

function AuditListItem({
  item,
  onSelect,
}: {
  item: SessionListItem
  onSelect: () => void
}) {
  return (
    <div className="session-item" onClick={onSelect} style={{ cursor: 'pointer' }}>
      <StatusBadge status={item.status} />
      <div className="session-meta">
        <span className="session-id">audit/{item.run_id.slice(0, 8)}</span>
        <span className="session-time">{new Date(item.created_at).toLocaleString('ru')}</span>
      </div>
      <span className="session-steps">{item.steps_count} шагов</span>
    </div>
  )
}

// ── Input screen ──────────────────────────────────────────────────────────

interface InputScreenProps {
  onStart: (session: AuditSession) => void
}

function InputScreen({ onStart }: InputScreenProps) {
  const [task, setTask] = useState('')
  const [startUrl, setStartUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  useEffect(() => {
    api.listAuditSessions().then(d => setSessions(d.sessions)).catch(() => {})
  }, [])

  async function handleRun() {
    if (!task.trim()) return
    setLoading(true)
    setError(null)
    try {
      const session = mkAudit(task.trim(), startUrl.trim() || undefined)
      onStart(session)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (selectedRunId) {
    const item = sessions.find(s => s.run_id === selectedRunId)
    if (item) {
      const runnerSession: RunnerSession = {
        id: item.run_id,
        title: `audit/${item.run_id.slice(0, 8)}`,
        source: 'manual',
        status: item.status,
        startedAt: new Date(item.created_at).getTime(),
        result: {
          status: item.status,
          summary: '',
          steps_count: item.steps_count,
          errors: [],
          screenshots: [],
          duration_sec: item.duration_sec,
          run_id: item.run_id,
        },
      }
      return (
        <RunnerSessionView
          session={runnerSession}
          wsPathPrefix="/audit/ws"
          stepsApiPath={`/audit/sessions/${item.run_id}/steps`}
          onBack={() => setSelectedRunId(null)}
          onRerun={() => setSelectedRunId(null)}
          onUpdate={() => {}}
        />
      )
    }
  }

  return (
    <div className="workspace-inner">
      <div className="page-header">
        <h1 className="page-title">Site Audit</h1>
        <span className="page-sub">browser-use</span>
      </div>

      <div className="source-card">
        <div className="source-input-row">
          <Globe size={14} className="source-icon" />
          <input
            className="source-input"
            placeholder="URL сайта (опционально)"
            value={startUrl}
            onChange={e => setStartUrl(e.target.value)}
          />
        </div>
        <textarea
          className="source-textarea"
          placeholder="Опишите задачу для аудита, например: проверь форму регистрации на наличие ошибок валидации"
          value={task}
          rows={4}
          onChange={e => setTask(e.target.value)}
        />
        {error && <div className="source-error">{error}</div>}
        <div className="source-actions">
          <button
            type="button"
            className="source-fetch-btn"
            disabled={loading || !task.trim()}
            onClick={handleRun}
          >
            {loading ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
            Запустить аудит
          </button>
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="sessions-panel">
          <div className="sessions-panel-title">История аудитов</div>
          {sessions.map(s => (
            <AuditListItem
              key={s.run_id}
              item={s}
              onSelect={() => setSelectedRunId(s.run_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main AuditView ────────────────────────────────────────────────────────

export function AuditView() {
  const [activeSession, setActiveSession] = useState<AuditSession | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  async function handleStart(session: AuditSession) {
    try {
      const { run_id } = await api.startAuditStreaming({
        task: session.task,
        start_url: session.startUrl,
      })
      setActiveSession({ ...session, id: run_id })
      setActiveRunId(run_id)
    } catch (err) {
      console.error('Audit start failed:', err)
    }
  }

  function handleDone(result: RunnerRunResponse) {
    if (activeSession) {
      setActiveSession({ ...activeSession, status: result.status, result, endedAt: Date.now() })
    }
  }

  if (activeSession && activeRunId) {
    const runnerSession: RunnerSession = {
      id: activeRunId,
      title: activeSession.title,
      source: 'manual',
      task: activeSession.task,
      startUrl: activeSession.startUrl,
      status: activeSession.status,
      startedAt: activeSession.startedAt,
      result: activeSession.result,
      endedAt: activeSession.endedAt,
    }
    return (
      <RunnerSessionView
        session={runnerSession}
        wsPathPrefix="/audit/ws"
        stepsApiPath={`/audit/sessions/${activeRunId}/steps`}
        onBack={() => { setActiveSession(null); setActiveRunId(null) }}
        onRerun={() => { setActiveSession(null); setActiveRunId(null) }}
        onUpdate={(update) => { if (update.result) handleDone(update.result) }}
      />
    )
  }

  return <InputScreen onStart={handleStart} />
}
