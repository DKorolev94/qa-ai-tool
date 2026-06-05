import { useEffect, useRef, useState } from 'react'
import { Loader2, MonitorPlay, X, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import type { RunnerRunResponse, RunnerStatus } from '../types'

const STATUS_CONFIG: Record<RunnerStatus, { label: string; pillClass: string; Icon: typeof CheckCircle2 }> = {
  passed:  { label: 'PASSED',  pillClass: 'pill-ok',   Icon: CheckCircle2 },
  failed:  { label: 'FAILED',  pillClass: 'pill-err',  Icon: XCircle },
  blocked: { label: 'BLOCKED', pillClass: 'pill-warn', Icon: AlertTriangle },
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}м ${s}с` : `${s}с`
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}м ${s}с` : `${s}с`
}

export function RunnerView() {
  const [testItId, setTestItId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RunnerRunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startTimer() {
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => () => stopTimer(), [])

  async function handleRun() {
    const id = testItId.trim()
    if (!id) return
    setLoading(true)
    setResult(null)
    setError(null)
    startTimer()
    try {
      const data = await api.runTestCase(id)
      setResult(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      stopTimer()
    }
  }

  function handleReset() {
    setResult(null)
    setError(null)
    setTestItId('')
  }

  const cfg = result ? STATUS_CONFIG[result.status] : null

  return (
    <div className="workspace-inner">
      <div className="workspace-col">

        {/* Header */}
        <div className="page-header" style={{ justifyContent: 'flex-start', gap: 8 }}>
          <MonitorPlay size={18} strokeWidth={1.75} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>Browser Runner</span>
        </div>

        {/* Input */}
        <div className="source-input-row">
          <input
            className="source-id-input"
            placeholder="TestIT ID, например 6109"
            value={testItId}
            onChange={e => setTestItId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleRun()}
            disabled={loading}
          />
          <button
            className={testItId.trim() && !loading ? 'source-fetch-btn' : 'source-fetch-btn source-fetch-btn-muted'}
            onClick={handleRun}
            disabled={loading || !testItId.trim()}
          >
            {loading
              ? <Loader2 size={14} className="spin-icon" />
              : 'Запустить'
            }
          </button>
          {(result || error) && (
            <button
              style={{ height: 40, width: 40, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              onClick={handleReset}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="runner-result-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Loader2 size={20} className="spin-icon" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Агент работает…</div>
                <div style={{ color: 'var(--tx-muted)', fontSize: 13 }}>{formatElapsed(elapsed)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="runner-result-card runner-result-card-err">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Ошибка запуска</div>
            <div style={{ fontSize: 13 }}>{error}</div>
          </div>
        )}

        {/* Result state */}
        {result && !loading && cfg && (
          <>
            <div className="runner-result-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <cfg.Icon size={18} />
                <span className={`case-pill ${cfg.pillClass}`} style={{ fontSize: 13, fontWeight: 700, height: 'auto', padding: '3px 10px' }}>
                  {cfg.label}
                </span>
                <span style={{ color: 'var(--tx-muted)', fontSize: 13, marginLeft: 'auto' }}>
                  {result.steps_count} шагов · {formatDuration(result.duration_sec)}
                </span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>{result.summary}</div>

              {result.errors.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Ошибки</div>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ color: 'var(--tx-muted)', fontSize: 13, marginBottom: 2 }}>• {e}</div>
                  ))}
                </div>
              )}
            </div>

            {result.screenshots.length > 0 && (
              <div className="runner-result-card">
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
                  Скриншоты ({result.screenshots.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {result.screenshots.map((s, i) => (
                    <img
                      key={i}
                      src={s.url}
                      alt={`Шаг ${i + 1}`}
                      style={{ width: 120, height: 72, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)' }}
                      onClick={() => setLightboxSrc(s.url)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Lightbox */}
      {lightboxSrc && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, cursor: 'zoom-out',
          }}
          onClick={() => setLightboxSrc(null)}
        >
          <img src={lightboxSrc} alt="Screenshot" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}
