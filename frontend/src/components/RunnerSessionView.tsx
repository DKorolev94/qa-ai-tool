import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2, ChevronLeft, ChevronRight, Clock, ImageOff, Loader2,
  Monitor, Play, Terminal, X, XCircle,
} from 'lucide-react'
import type {
  ActionDetail, HistoricalStep, RunnerSession, RunnerSessionStatus,
  WsDoneEvent, WsEvent, WsLogEvent, WsStepEvent,
} from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}м ${String(s % 60).padStart(2, '0')}с` : `${s}с`
}

function pluralSteps(n: number): string {
  const last2 = Math.abs(n) % 100
  const last = Math.abs(n) % 10
  if (last2 >= 11 && last2 <= 19) return `${n} шагов`
  if (last === 1) return `${n} шаг`
  if (last >= 2 && last <= 4) return `${n} шага`
  return `${n} шагов`
}

function cleanSummary(raw: string): string {
  return raw
    .replace(/^Action (?:completed successfully|was not able to be completed)[:\s]*/i, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^Step:\s*/i, '')
    .trim()
    .split('\n')[0]
    .trim()
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
  action?: ActionDetail
  expected?: string
  actual?: string
  stepVerdict?: 'passed' | 'failed'
}

function stepFromLive(e: WsStepEvent): UiStep {
  return {
    num: e.step,
    summary: e.next_goal || `Шаг ${e.step}`,
    url: e.url || undefined,
    status: e.status === 'error' ? 'error' : 'ok',
    elapsedSec: e.elapsed_sec,
    screenshotB64: e.screenshot_b64,
    action: e.action,
    expected: e.expected,
    actual: e.actual,
    stepVerdict: e.step_verdict,
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
    action: h.action,
    expected: h.expected,
    actual: h.actual,
    stepVerdict: h.step_verdict,
  }
}

// ── Step item ─────────────────────────────────────────────────────────────

function parseActDetail(resultMessage: string | undefined, target: string | undefined) {
  const raw = resultMessage || target || ''
  const selectorMatch = raw.match(/\*\*Selector\*\*[:\s]+([^\n]+)/)
  const reasoningMatch = raw.match(/\*\*Reasoning\*\*[:\s]+([\s\S]+?)(?:\n\n|\*\*|$)/)
  const actionMatch = raw.match(/#+\s*(?:Step[:\s]+)?(.+?)(?:\n|$)/)
  return {
    element: selectorMatch?.[1]?.trim(),
    agentAction: actionMatch?.[1]?.trim().replace(/\*\*/g, ''),
    reasoning: reasoningMatch?.[1]?.trim().replace(/\n/g, ' ').slice(0, 200),
  }
}

function StepItem({
  step, onClick, highlighted, stepRef, alwaysClickable,
}: {
  step: UiStep
  onClick: () => void
  highlighted?: boolean
  stepRef?: (el: HTMLDivElement | null) => void
  alwaysClickable?: boolean
}) {
  const isCurrent = step.status === 'current'
  const isErr = step.status === 'error'
  const hasThumb = !!(step.screenshotB64 || step.screenshotUrl)
  const thumbSrc = step.screenshotB64
    ? `data:image/png;base64,${step.screenshotB64}`
    : step.screenshotUrl
  const isClickable = alwaysClickable || hasThumb

  const hasDetail = !!(step.action?.result_message || step.action?.target)
  const detail = hasDetail ? parseActDetail(step.action?.result_message, step.action?.target) : null

  return (
    <div
      ref={stepRef}
      className={[
        'step-item',
        isErr ? 'step-item--error' : isCurrent ? 'step-item--current' : 'step-item--done',
        highlighted ? 'step-item--highlighted' : '',
      ].filter(Boolean).join(' ')}
      onClick={isClickable ? onClick : undefined}
      style={isClickable ? { cursor: 'pointer' } : undefined}
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
          {step.stepVerdict && (
            <span className={`step-verdict step-verdict--${step.stepVerdict}`}>
              {step.stepVerdict === 'passed' ? '✓' : '✗'} {step.stepVerdict}
            </span>
          )}
        </span>
        <span className="step-summary" title={step.summary}>{cleanSummary(step.summary)}</span>
        {step.expected && (
          <div className="step-expect-block">
            <span className="step-expect-label">Ожидалось:</span>
            <span className="step-expect-val">{step.expected}</span>
          </div>
        )}
        {step.actual && (
          <div className="step-expect-block">
            <span className="step-expect-label step-expect-label--agent">Агент:</span>
            <span className="step-expect-val step-expect-val--agent">{step.actual}</span>
          </div>
        )}
        {step.url && (
          <span className="step-url" title={step.url}>{step.url}</span>
        )}
        {detail && (detail.element || detail.agentAction || detail.reasoning) && (
          <details className="step-details-raw">
            <summary>Подробнее</summary>
            <div className="step-raw-content">
              {detail.agentAction && (
                <div className="step-raw-line">
                  <span className="step-raw-label">Действие:</span> {detail.agentAction}
                </div>
              )}
              {detail.element && (
                <div className="step-raw-line step-raw-dim">
                  <span className="step-raw-label">Элемент:</span> <code>{detail.element}</code>
                </div>
              )}
              {detail.reasoning && (
                <div className="step-raw-line step-raw-dim">
                  <span className="step-raw-label">Вывод:</span> {detail.reasoning}
                </div>
              )}
            </div>
          </details>
        )}
      </div>
      {thumbSrc && !alwaysClickable && (
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
  running, steps, onClickStep, highlightedStep, stepRefs, isCompleted,
}: {
  running: boolean
  steps: UiStep[]
  onClickStep: (stepNum: number) => void
  highlightedStep?: number | null
  stepRefs: React.MutableRefObject<Map<number, HTMLDivElement>>
  isCompleted?: boolean
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
        {steps.map(s => (
          <StepItem
            key={`${s.num}-${s.status}`}
            step={s}
            onClick={() => onClickStep(s.num)}
            highlighted={highlightedStep === s.num}
            alwaysClickable={isCompleted}
            stepRef={el => {
              if (el) stepRefs.current.set(s.num, el)
              else stepRefs.current.delete(s.num)
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ── View tabs ─────────────────────────────────────────────────────────────

type ViewTab = 'browser' | 'logs'

function ViewTabs({
  active, onChange, logCount, isCompleted,
}: {
  active: ViewTab
  onChange: (tab: ViewTab) => void
  logCount: number
  isCompleted?: boolean
}) {
  const browserLabel = isCompleted ? 'Снимок' : 'Статус'
  const tabs: { id: ViewTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'browser', label: browserLabel, icon: <Monitor  size={12} /> },
    { id: 'logs',    label: 'Логи',       icon: <Terminal size={12} />, badge: logCount > 0 ? logCount : undefined },
  ]
  return (
    <div className="session-view-tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          className={`session-view-tab${active === tab.id ? ' session-view-tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon}
          {tab.label}
          {tab.badge != null && (
            <span className="session-view-tab-badge">{tab.badge > 999 ? '999+' : tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Log stream ────────────────────────────────────────────────────────────

function LogsPane({
  logs, running, isCompleted, logsLoading,
}: {
  logs: WsLogEvent[]
  running: boolean
  isCompleted?: boolean
  logsLoading?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showVerbose, setShowVerbose] = useState(false)
  const [catFilters, setCatFilters] = useState<Set<string>>(new Set())

  const categories = Array.from(new Set(logs.map(l => l.category))).sort()

  const visible = logs.filter(l => {
    if (!showVerbose && l.level === 'verbose') return false
    if (catFilters.size > 0 && !catFilters.has(l.category)) return false
    return true
  })

  const toggleCat = (cat: string) => {
    setCatFilters(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  useEffect(() => {
    if (running && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visible.length, running])

  const hasLogs = logs.length > 0

  function emptyMessage() {
    if (logsLoading) return 'Загрузка логов…'
    if (running) return 'Логи появятся во время выполнения…'
    if (isCompleted) return 'Логи не сохранены'
    return 'Нет логов'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {hasLogs && (
        <div className="session-logs-toolbar">
          <label className="session-logs-verbose-toggle">
            <input type="checkbox" checked={showVerbose} onChange={e => setShowVerbose(e.target.checked)} />
            verbose
          </label>
          {categories.length > 1 && (
            <div className="session-logs-cats">
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={`session-log-cat-chip${catFilters.has(cat) ? ' session-log-cat-chip--on' : ''}`}
                  onClick={() => toggleCat(cat)}
                  title={cat}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="session-logs-scroll" ref={scrollRef}>
        {visible.length === 0 ? (
          <div className="session-logs-empty">
            {logsLoading
              ? <><Loader2 size={13} className="spin-icon" style={{ display: 'inline-block', marginRight: 6 }} /> Загрузка логов…</>
              : (logs.length > 0 ? 'Нет логов по фильтру' : emptyMessage())}
          </div>
        ) : (
          visible.map((log, i) => (
            <div key={i} className={`session-log-line session-log--${log.level}`}>
              <span className="session-log-time">{log.elapsed_sec.toFixed(1)}с</span>
              <span className="session-log-cat">{log.category}</span>
              <span className="session-log-msg">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}



// ── Running status panel ──────────────────────────────────────────────────

function RunningStatusPanel({ steps }: { steps: UiStep[] }) {
  const lastStep = steps[steps.length - 1] ?? null
  const displayStep = lastStep

  return (
    <div className="session-running-panel">
      <div className="session-running-spinner">
        <Loader2 size={28} strokeWidth={1.5} className="spin-icon" />
      </div>
      <div className="session-running-lbl">Агент выполняет шаги…</div>
      {displayStep ? (
        <div className="session-running-step-card">
          <span className="session-running-step-num">Шаг {displayStep.num}</span>
          <span className="session-running-step-sum">{cleanSummary(displayStep.summary)}</span>
        </div>
      ) : (
        <div className="steps-dots"><span /><span /><span /></div>
      )}
    </div>
  )
}

// ── Completed screenshot viewer ───────────────────────────────────────────

function CompletedScreenshot({ step }: { step: UiStep | null }) {
  if (!step) {
    return (
      <div className="session-viewport-inner session-vp--empty">
        <Monitor size={30} strokeWidth={1.2} style={{ opacity: 0.2 }} />
      </div>
    )
  }

  const src = step.screenshotB64
    ? `data:image/png;base64,${step.screenshotB64}`
    : step.screenshotUrl || null

  if (!src) {
    return (
      <div className="session-viewport-inner session-vp--running">
        <ImageOff size={30} strokeWidth={1.2} style={{ opacity: 0.3 }} />
        <div className="session-vp-note" style={{ marginTop: 4 }}>Скриншоты не сохранены</div>
      </div>
    )
  }

  return (
    <div className="session-viewport-inner" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <img src={src} alt={`Шаг ${step.num}`} className="session-final-shot" />
      <div className="session-vp-step-caption">
        Шаг {step.num} — {cleanSummary(step.summary)}
      </div>
    </div>
  )
}

// ── Session footer ────────────────────────────────────────────────────────

function SessionFooter({
  doneEvent, failedStepNum, onRerun, onNewRun, onScrollToStep,
}: {
  doneEvent: WsDoneEvent
  failedStepNum?: number | null
  onRerun: () => void
  onNewRun: () => void
  onScrollToStep?: (stepNum: number) => void
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
        <span className="session-footer-meta">{pluralSteps(doneEvent.steps_count)}</span>
        {showReason && (
          <>
            <span className="session-footer-div" />
            {failedStepNum != null && onScrollToStep && (
              <button
                type="button"
                className="session-footer-step-link"
                onClick={() => onScrollToStep(failedStepNum)}
              >
                Шаг {failedStepNum}
              </button>
            )}
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

interface LbItem {
  src: string
  caption: string
}

function Lightbox({
  item, onClose, onPrev, onNext,
}: {
  item: LbItem
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
      <div className="lb-content" onClick={e => e.stopPropagation()}>
        <img src={item.src} alt="Screenshot" className="lb-img" />
        {item.caption && <div className="lb-caption">{item.caption}</div>}
      </div>
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
  wsPathPrefix?: string
  stepsApiPath?: string
  externalRunId?: string
}

export function RunnerSessionView({ session, onBack, onRerun, onUpdate, wsPathPrefix, stepsApiPath, externalRunId }: RunnerSessionViewProps) {
  const [liveSteps, setLiveSteps] = useState<WsStepEvent[]>([])
  const [logEvents, setLogEvents] = useState<WsLogEvent[]>([])
  const [historicalSteps, setHistoricalSteps] = useState<HistoricalStep[] | null>(null)
  const [historicalLogs, setHistoricalLogs] = useState<WsLogEvent[] | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [selectedStepNum, setSelectedStepNum] = useState<number | null>(null)
  const [doneEvent, setDoneEvent] = useState<WsDoneEvent | null>(
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
  const [viewTab, setViewTab] = useState<ViewTab>('browser')
  const [highlightedStep, setHighlightedStep] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onUpdateRef = useRef(onUpdate)
  const mountedRef = useRef(true)
  const stepRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { onUpdateRef.current = onUpdate })

  const isRunning = session.status === 'running'

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 500)
    return () => clearInterval(id)
  }, [isRunning, startTime])

  useEffect(() => {
    if (session.status !== 'running' && session.result?.run_id && !historicalSteps) {
      const runId = session.result.run_id
      const path = stepsApiPath ?? `/runner/sessions/${runId}/steps`
      fetch(`/api${path}`)
        .then(res => res.json() as Promise<{ steps: HistoricalStep[] }>)
        .then(data => { if (mountedRef.current) setHistoricalSteps(data.steps) })
        .catch(() => {})

      // Load historical logs
      if (historicalLogs === null) {
        setLogsLoading(true)
        fetch(`/api/runner/sessions/${runId}/logs`)
          .then(res => res.json() as Promise<{ logs: Array<{ level: string; category: string; message: string; elapsed_sec: number }> }>)
          .then(data => {
            if (!mountedRef.current) return
            setHistoricalLogs(data.logs.map(l => ({ ...l, type: 'log' as const, level: l.level as WsLogEvent['level'] })))
          })
          .catch(() => { if (mountedRef.current) setHistoricalLogs([]) })
          .finally(() => { if (mountedRef.current) setLogsLoading(false) })
      }
    }
  }, [session.status, session.result?.run_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isRunning) return
    mountedRef.current = true
    const abort = new AbortController()

    const startAndConnect = async () => {
      try {
        let runId: string
        if (externalRunId) {
          runId = externalRunId
        } else {
          const path = session.source === 'manual' ? '/api/runner/start-manual' : '/api/runner/start-testit'
          const body = session.source === 'manual'
            ? { task: session.task!, start_url: session.startUrl }
            : { work_item_id: session.workItemId!, iteration_index: session.iterationIndex ?? 0 }

          const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abort.signal,
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json() as { run_id: string }
          runId = data.run_id
        }

        if (abort.signal.aborted || !mountedRef.current) return

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsPrefix = wsPathPrefix ?? '/runner/ws'
        const ws = new WebSocket(`${proto}://${window.location.host}/api${wsPrefix}/${runId}`)
        wsRef.current = ws
        let receivedDone = false

        ws.onmessage = (ev) => {
          if (!mountedRef.current) return
          let event: WsEvent
          try { event = JSON.parse(ev.data) } catch { return }

          if (event.type === 'step') {
            setLiveSteps(prev => {
              const filtered = prev.filter(s => s.step !== (event as WsStepEvent).step)
              return [...filtered, event as WsStepEvent].sort((a, b) => a.step - b.step)
            })
          } else if (event.type === 'log') {
            setLogEvents(prev => [...prev, event as WsLogEvent])
          } else if (event.type === 'done') {
            receivedDone = true
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
            receivedDone = true
            setWsError((event as { type: string; message: string }).message)
            onUpdateRef.current({ status: 'blocked', endedAt: Date.now() })
          }
        }

        ws.onclose = () => {
          if (!mountedRef.current || receivedDone) return
          onUpdateRef.current({ status: 'blocked', endedAt: Date.now() })
        }

        ws.onerror = () => {
          if (!mountedRef.current) return
          receivedDone = true
          setWsError('Ошибка WebSocket соединения')
          onUpdateRef.current({ status: 'blocked', endedAt: Date.now() })
        }

      } catch (err) {
        if (abort.signal.aborted) return
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

  // Build display steps
  const uiSteps: UiStep[] = (() => {
    if (historicalSteps) return historicalSteps.map(stepFromHistory)
    return liveSteps.map(stepFromLive)
  })()

  const isCompleted = !isRunning
  const effectiveSelectedStep = selectedStepNum ?? (isCompleted && uiSteps.length > 0 ? uiSteps[uiSteps.length - 1].num : null)
  const selectedUiStep = isCompleted ? (uiSteps.find(s => s.num === effectiveSelectedStep) ?? null) : null

  const failedStepNum = uiSteps.find(s => s.status === 'error')?.num ?? null

  // Lightbox items (steps with screenshots)
  const lbItems: LbItem[] = uiSteps
    .filter(s => s.screenshotB64 || s.screenshotUrl)
    .map(s => ({
      src: s.screenshotB64 ? `data:image/png;base64,${s.screenshotB64}` : s.screenshotUrl!,
      caption: `Шаг ${s.num}${s.elapsedSec != null ? ` · ${s.elapsedSec}с` : ''} — ${s.summary}`,
    }))

  const stepNumToLbIdx = new Map<number, number>()
  uiSteps.filter(s => s.screenshotB64 || s.screenshotUrl)
    .forEach((s, i) => stepNumToLbIdx.set(s.num, i))

  const scrollToStep = (stepNum: number) => {
    setHighlightedStep(stepNum)
    stepRefs.current.get(stepNum)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedStep(null), 2200)
  }

  const displayTime = isRunning
    ? elapsed
    : doneEvent
      ? Math.round(doneEvent.duration_sec)
      : Math.round(session.result?.duration_sec ?? 0)

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
          {!isRunning && (
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
        {/* Left: tabbed content zone */}
        <div className="session-viewport-zone">
          <ViewTabs
            active={viewTab}
            onChange={setViewTab}
            logCount={logEvents.length}
            isCompleted={isCompleted}
          />
          {viewTab === 'browser' && (
            isRunning ? (
              <RunningStatusPanel steps={uiSteps} />
            ) : (
              <CompletedScreenshot step={selectedUiStep} />
            )
          )}
          {viewTab === 'logs' && (
            <LogsPane
              logs={isCompleted && historicalLogs !== null ? historicalLogs : logEvents}
              running={isRunning}
              isCompleted={isCompleted}
              logsLoading={logsLoading}
            />
          )}
        </div>

        {/* Right: steps feed */}
        <StepsFeed
          running={isRunning}
          steps={uiSteps}
          onClickStep={(stepNum) => {
            if (isCompleted) {
              setSelectedStepNum(stepNum)
              setViewTab('browser')
            } else {
              const idx = stepNumToLbIdx.get(stepNum)
              if (idx != null) setLbIdx(idx)
            }
          }}
          highlightedStep={isCompleted ? effectiveSelectedStep : highlightedStep}
          stepRefs={stepRefs}
          isCompleted={isCompleted}
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
        <SessionFooter
          doneEvent={doneEvent}
          failedStepNum={failedStepNum}
          onRerun={onRerun}
          onNewRun={onBack}
          onScrollToStep={scrollToStep}
        />
      )}

      {/* Lightbox */}
      {lbIdx !== null && lbItems[lbIdx] && (
        <Lightbox
          item={lbItems[lbIdx]}
          onClose={() => setLbIdx(null)}
          onPrev={lbIdx > 0 ? () => setLbIdx(lbIdx - 1) : undefined}
          onNext={lbIdx < lbItems.length - 1 ? () => setLbIdx(lbIdx + 1) : undefined}
        />
      )}
    </div>
  )
}
