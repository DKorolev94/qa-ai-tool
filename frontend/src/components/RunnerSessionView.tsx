import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2,
  Monitor, Play, Square, X, XCircle,
} from 'lucide-react'
import type {
  HistoricalStep, RunnerSession, RunnerSessionStatus,
  WsDoneEvent, WsEvent, WsStepEvent,
} from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}м ${String(s % 60).padStart(2, '0')}с` : `${s}с`
}

// ── Status badge ──────────────────────────────────────────────────────────

const BADGE_CFG: Record<RunnerSessionStatus, { label: string; cls: string }> = {
  running: { label: 'Выполняется', cls: 'sess-badge--running' },
  passed:  { label: 'Passed',      cls: 'sess-badge--passed'  },
  failed:  { label: 'Failed',      cls: 'sess-badge--failed'  },
  blocked: { label: 'Blocked',     cls: 'sess-badge--blocked' },
}

export function StatusBadge({ status }: { status: string }) {
  const cfg = BADGE_CFG[status as RunnerSessionStatus] ?? { label: status, cls: 'sess-badge--blocked' }
  return <span className={`sess-badge ${cfg.cls}`}>{cfg.label}</span>
}

// ── Unified step shape ────────────────────────────────────────────────────

interface UiStep {
  num: number
  summary: string
  url?: string
  status: 'ok' | 'error' | 'current'
  elapsedSec?: number
  screenshotB64?: string
  screenshotUrl?: string
}

function stepFromLive(e: WsStepEvent): UiStep {
  return {
    num: e.step,
    summary: e.next_goal || `Шаг ${e.step}`,
    url: e.url || undefined,
    status: 'ok',
    elapsedSec: e.elapsed_sec,
    screenshotB64: e.screenshot_b64,
  }
}

function stepFromHistory(h: HistoricalStep): UiStep {
  return {
    num: h.step,
    summary: h.summary || `Шаг ${h.step}`,
    url: h.url || undefined,
    status: h.status === 'error' ? 'error' : 'ok',
    elapsedSec: h.duration_sec ?? undefined,
    screenshotUrl: h.screenshot?.url,
  }
}

// ── Browser viewport zone ─────────────────────────────────────────────────

function ViewportZone({
  running,
  screenshotB64,
  screenshotUrl,
  hasStream,
}: {
  running: boolean
  screenshotB64?: string
  screenshotUrl?: string
  hasStream: boolean
}) {
  const src = screenshotB64
    ? `data:image/png;base64,${screenshotB64}`
    : screenshotUrl || null

  if (src) {
    return (
      <div className="session-viewport-inner">
        <img src={src} alt="Снимок браузера" className="session-final-shot" />
        {running && (
          <div className="session-vp-refreshing">
            <Loader2 size={14} className="spin-icon" /> обновляется…
          </div>
        )}
      </div>
    )
  }

  if (running) {
    return (
      <div className="session-viewport-inner session-vp--running">
        <div className="session-vp-icon"><Monitor size={40} strokeWidth={1.2} /></div>
        <div className="session-vp-title">Агент работает в браузере</div>
        <div className="session-vp-note">
          {hasStream
            ? 'Ожидание первого шага…'
            : 'Снимки шагов появятся по мере выполнения'}
        </div>
      </div>
    )
  }

  return (
    <div className="session-viewport-inner session-vp--empty">
      <Monitor size={30} strokeWidth={1.2} style={{ opacity: 0.2 }} />
    </div>
  )
}

// ── Step item ─────────────────────────────────────────────────────────────

function StepItem({ step, onClick }: { step: UiStep; onClick: () => void }) {
  const isCurrent = step.status === 'current'
  const isErr = step.status === 'error'
  const hasThumb = !!(step.screenshotB64 || step.screenshotUrl)
  const thumbSrc = step.screenshotB64
    ? `data:image/png;base64,${step.screenshotB64}`
    : step.screenshotUrl

  return (
    <div
      className={`step-item${isErr ? ' step-item--error' : isCurrent ? ' step-item--current' : ' step-item--done'}`}
      onClick={hasThumb ? onClick : undefined}
      style={hasThumb ? { cursor: 'pointer' } : undefined}
      ref={isCurrent ? (el => el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })) : undefined}
    >
      <div className="step-icon-col">
        {isCurrent
          ? <Loader2 size={13} strokeWidth={1.75} className="spin-icon" style={{ color: 'var(--accent)' }} />
          : isErr
            ? <XCircle size={13} strokeWidth={1.75} style={{ color: '#DC2626' }} />
            : <CheckCircle2 size={13} strokeWidth={1.75} style={{ color: '#059669' }} />}
      </div>
      <div className="step-body-col">
        <span className="step-label-num">
          Шаг {step.num}
          {step.elapsedSec != null && (
            <span className="step-elapsed"> · {step.elapsedSec}с</span>
          )}
        </span>
        <span className="step-summary">{step.summary}</span>
        {step.url && (
          <span className="step-url" title={step.url}>{step.url}</span>
        )}
      </div>
      {thumbSrc && (
        <img
          src={thumbSrc}
          alt={`Шаг ${step.num}`}
          className="step-thumb"
          onClick={e => { e.stopPropagation(); onClick() }}
        />
      )}
    </div>
  )
}

// ── Steps feed ────────────────────────────────────────────────────────────

function StepsFeed({
  running, steps, onClickStep,
}: {
  running: boolean
  steps: UiStep[]
  onClickStep: (idx: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (running && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [steps.length, running])

  return (
    <div className="session-steps-panel">
      <div className="rail-head">
        <span className="rail-title">Шаги</span>
        {steps.length > 0 && <span className="rail-count">{steps.length}</span>}
      </div>
      <div className="rail-scroll" ref={scrollRef} style={{ gap: 4 }}>
        {running && steps.length === 0 && (
          <div className="steps-waiting">
            <div className="steps-dots"><span /><span /><span /></div>
            <span className="steps-waiting-lbl">Агент выполняет шаги…</span>
          </div>
        )}
        {steps.map((s, i) => (
          <StepItem key={`${s.num}-${s.status}`} step={s} onClick={() => onClickStep(i)} />
        ))}
      </div>
    </div>
  )
}

// ── Session footer ────────────────────────────────────────────────────────

function SessionFooter({
  doneEvent, onRerun, onNewRun,
}: {
  doneEvent: WsDoneEvent
  onRerun: () => void
  onNewRun: () => void
}) {
  const showReason = (doneEvent.status === 'failed' || doneEvent.status === 'blocked') && doneEvent.summary
  const BADGE: Record<string, { cls: string; label: string }> = {
    passed:  { cls: 'sess-badge--passed',  label: 'Passed'  },
    failed:  { cls: 'sess-badge--failed',  label: 'Failed'  },
    blocked: { cls: 'sess-badge--blocked', label: 'Blocked' },
  }
  const badge = BADGE[doneEvent.status] ?? BADGE.blocked
  return (
    <div className="session-footer">
      <div className="session-footer-info">
        <span className={`sess-badge ${badge.cls}`}>{badge.label}</span>
        <span className="session-footer-div" />
        <Clock size={12} strokeWidth={1.75} style={{ color: 'var(--tx-dim)', flexShrink: 0 }} />
        <span className="session-footer-meta">{Math.round(doneEvent.duration_sec)}с</span>
        <span className="session-footer-div" />
        <span className="session-footer-meta">{doneEvent.steps_count} шагов</span>
        {showReason && (
          <>
            <span className="session-footer-div" />
            <span className="session-footer-reason" title={doneEvent.summary}>{doneEvent.summary}</span>
          </>
        )}
      </div>
      <div className="session-footer-btns">
        <button
          type="button"
          className="source-fetch-btn"
          style={{ height: 34, fontSize: 12, padding: '0 14px' }}
          onClick={onRerun}
        >
          <Play size={13} /> Повторить прогон
        </button>
        <button type="button" className="session-newrun-btn" onClick={onNewRun}>
          Новый запуск
        </button>
      </div>
    </div>
  )
}

// ── Lightbox ──────────────────────────────────────────────────────────────

function Lightbox({
  src, onClose, onPrev, onNext,
}: {
  src: string
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev?.()
      if (e.key === 'ArrowRight') onNext?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])
  return (
    <div className="lb-overlay" onClick={onClose}>
      {onPrev && (
        <button type="button" className="lb-nav lb-nav--prev"
          onClick={e => { e.stopPropagation(); onPrev() }}>
          <ChevronLeft size={22} />
        </button>
      )}
      <img src={src} alt="Screenshot" className="lb-img" onClick={e => e.stopPropagation()} />
      {onNext && (
        <button type="button" className="lb-nav lb-nav--next"
          onClick={e => { e.stopPropagation(); onNext() }}>
          <ChevronRight size={22} />
        </button>
      )}
      <button type="button" className="lb-close" onClick={onClose}><X size={18} /></button>
    </div>
  )
}

// ── RunnerSessionView ─────────────────────────────────────────────────────

export interface RunnerSessionViewProps {
  session: RunnerSession
  onBack: () => void
  onRerun: () => void
  onUpdate: (update: Partial<RunnerSession>) => void
  wsPathPrefix?: string    // default: '/runner/ws'
  stepsApiPath?: string    // default: '/runner/sessions/:run_id/steps'
}

export function RunnerSessionView({ session, onBack, onRerun, onUpdate, wsPathPrefix, stepsApiPath }: RunnerSessionViewProps) {
  const [liveSteps, setLiveSteps] = useState<WsStepEvent[]>([])
  const [historicalSteps, setHistoricalSteps] = useState<HistoricalStep[] | null>(null)
  const [doneEvent, setDoneEvent] = useState<WsDoneEvent | null>(
    // If session was loaded from history (already completed), synthetic doneEvent from result
    session.result
      ? {
          type: 'done',
          status: session.result.status,
          summary: session.result.summary,
          duration_sec: session.result.duration_sec,
          steps_count: session.result.steps_count,
          errors: session.result.errors,
          run_id: session.result.run_id,
        }
      : null
  )
  const [wsError, setWsError] = useState<string | null>(null)
  const [startTime] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [lbIdx, setLbIdx] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onUpdateRef = useRef(onUpdate)
  const mountedRef = useRef(true)

  useEffect(() => { onUpdateRef.current = onUpdate })

  // Timer — ticks every 500ms while running
  const isRunning = session.status === 'running'
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 500)
    return () => clearInterval(id)
  }, [isRunning, startTime])

  // Load historical steps for completed sessions (from history)
  useEffect(() => {
    if (session.status !== 'running' && session.result?.run_id && !historicalSteps) {
      const path = stepsApiPath ?? `/runner/sessions/${session.result.run_id}/steps`
      fetch(`/api${path}`)
        .then(res => res.json() as Promise<{ steps: HistoricalStep[] }>)
        .then(data => { if (mountedRef.current) setHistoricalSteps(data.steps) })
        .catch(() => {})
    }
  }, [session.status, session.result?.run_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Start WebSocket and run for new sessions
  useEffect(() => {
    if (!isRunning) return
    mountedRef.current = true
    const abort = new AbortController()

    const startAndConnect = async () => {
      try {
        // Start the run — use fetch with AbortSignal to cancel on Strict Mode unmount
        const path = session.source === 'manual' ? '/api/runner/start-manual' : '/api/runner/start-testit'
        const body = session.source === 'manual'
          ? { task: session.task!, start_url: session.startUrl }
          : { work_item_id: session.workItemId! }

        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abort.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const { run_id: runId } = await res.json() as { run_id: string }

        if (abort.signal.aborted || !mountedRef.current) return

        // Open WebSocket
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsPrefix = wsPathPrefix ?? '/runner/ws'
        const ws = new WebSocket(`${proto}://${window.location.host}/api${wsPrefix}/${runId}`)
        wsRef.current = ws

        ws.onmessage = (ev) => {
          if (!mountedRef.current) return
          let event: WsEvent
          try { event = JSON.parse(ev.data) } catch { return }

          if (event.type === 'step') {
            setLiveSteps(prev => {
              const filtered = prev.filter(s => s.step !== (event as WsStepEvent).step)
              return [...filtered, event as WsStepEvent].sort((a, b) => a.step - b.step)
            })
          } else if (event.type === 'done') {
            const de = event as WsDoneEvent
            setDoneEvent(de)
            onUpdateRef.current({
              status: de.status,
              endedAt: Date.now(),
              result: {
                status: de.status,
                summary: de.summary,
                duration_sec: de.duration_sec,
                steps_count: de.steps_count,
                errors: de.errors,
                screenshots: [],
                run_id: de.run_id,
              },
            })
          } else if (event.type === 'error') {
            setWsError((event as { type: string; message: string }).message)
            onUpdateRef.current({ status: 'blocked', endedAt: Date.now() })
          }
        }

        ws.onerror = () => {
          if (!mountedRef.current) return
          setWsError('Ошибка WebSocket соединения')
          onUpdateRef.current({ status: 'blocked', endedAt: Date.now() })
        }

      } catch (err) {
        if (abort.signal.aborted) return  // Strict Mode cleanup — ignore
        if (!mountedRef.current) return
        setWsError((err as Error).message)
        onUpdateRef.current({ status: 'blocked', endedAt: Date.now() })
      }
    }

    startAndConnect()

    return () => {
      mountedRef.current = false
      abort.abort()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Build display steps (live or historical)
  const uiSteps: UiStep[] = (() => {
    if (historicalSteps) return historicalSteps.map(stepFromHistory)
    if (liveSteps.length > 0) {
      const steps = liveSteps.map(stepFromLive)
      if (isRunning) {
        // Last step is "current" (in progress), rest are done
        // Actually: all received steps are completed (callback fires after LLM decides)
        // We show a "current" phantom step after the last received
        return steps
      }
      return steps
    }
    return []
  })()

  // For lightbox: collect all screenshot sources
  const lbSources: string[] = uiSteps
    .map(s => (s.screenshotB64 ? `data:image/png;base64,${s.screenshotB64}` : s.screenshotUrl || ''))
    .filter(Boolean)

  // Last screenshot for the viewport
  const lastLiveShot = liveSteps.length > 0 ? liveSteps[liveSteps.length - 1].screenshot_b64 : undefined
  const lastHistoricalUrl = historicalSteps
    ? historicalSteps[historicalSteps.length - 1]?.screenshot?.url
    : undefined

  const displayTime = isRunning
    ? elapsed
    : doneEvent
      ? Math.round(doneEvent.duration_sec)
      : Math.round(session.result?.duration_sec ?? 0)

  const hasStream = wsRef.current !== null || liveSteps.length > 0

  return (
    <div className="session-layout">

      {/* Header */}
      <div className="session-hdr">
        <div className="session-hdr-left">
          <button type="button" className="back-btn" onClick={onBack}>
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <div className="session-title-grp">
            <span className="session-title-txt" title={session.title}>{session.title}</span>
            <StatusBadge status={session.status} />
          </div>
        </div>
        <div className="session-hdr-right">
          <div className="session-timer">
            <Clock size={13} strokeWidth={1.75} />
            <span>{fmtSec(displayTime)}</span>
          </div>
          {isRunning ? (
            <button type="button" className="session-stop-btn" disabled title="browser-use не поддерживает остановку на лету">
              <Square size={12} strokeWidth={2} /> Остановить
            </button>
          ) : (
            <button
              type="button"
              className="source-fetch-btn"
              style={{ height: 36, fontSize: 12, padding: '0 14px' }}
              onClick={onRerun}
            >
              <Play size={13} /> Повторить
            </button>
          )}
        </div>
      </div>

      {/* Main two-column area */}
      <div className="session-main">
        {/* Left: viewport */}
        <div className="session-viewport-zone">
          <div className="session-vp-bar">
            <Monitor size={13} strokeWidth={1.75} />
            <span>Браузер</span>
            {isRunning && liveSteps.length > 0 && (
              <span className="session-live-dot">LIVE</span>
            )}
          </div>
          <ViewportZone
            running={isRunning}
            screenshotB64={lastLiveShot}
            screenshotUrl={lastHistoricalUrl}
            hasStream={hasStream}
          />
        </div>

        {/* Right: steps */}
        <StepsFeed
          running={isRunning}
          steps={uiSteps}
          onClickStep={(i) => {
            if (lbSources[i]) setLbIdx(i)
          }}
        />
      </div>

      {/* WS error banner */}
      {wsError && !isRunning && (
        <div className="session-ws-error">
          <XCircle size={14} strokeWidth={1.75} />
          {wsError}
        </div>
      )}

      {/* Footer result */}
      {!isRunning && doneEvent && (
        <SessionFooter doneEvent={doneEvent} onRerun={onRerun} onNewRun={onBack} />
      )}

      {/* Lightbox */}
      {lbIdx !== null && lbSources[lbIdx] && (
        <Lightbox
          src={lbSources[lbIdx]}
          onClose={() => setLbIdx(null)}
          onPrev={lbIdx > 0 ? () => setLbIdx(lbIdx - 1) : undefined}
          onNext={lbIdx < lbSources.length - 1 ? () => setLbIdx(lbIdx + 1) : undefined}
        />
      )}
    </div>
  )
}
