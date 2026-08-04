import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Clock, Loader2,
  Monitor, Square, Terminal, Video, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import i18n from '../i18n'
import type {
  ActionDetail, HistoricalStep, RunnerSession, RunnerSessionStatus,
  WsDoneEvent, WsEvent, WsFrameEvent, WsLogEvent, WsStepEvent, WsStepPendingEvent, WsStepUpdateEvent,
} from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function fmtSecShort(s: number, t: TFunction): string {
  return t('runnerSession.timeShort', { s })
}

function pluralSteps(n: number, t: TFunction): string {
  return t('runnerSession.stepsCount', { count: n })
}

function pluralActions(n: number): string {
  return `${n} ${n === 1 ? 'action' : 'actions'}`
}

function cleanSummary(raw: string): string {
  return raw
    .replace(/^Action (?:completed successfully|was not able to be completed)[:\s]*/i, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^Step:\s*/i, '')
    .replace(/[.,;]?\s*(?:as required by step \d+|Verdict:\s*\w+|as per (?:the )?(?:step|task|instructions?)[^.]*)\s*\.?\s*$/i, '')
    .trim()
    .split('\n')[0]
    .trim()
}

// ── Status badge ──────────────────────────────────────────────────────────

const BADGE_CFG: Record<string, { key: string; cls: string }> = {
  running:          { key: 'running',         cls: 'sess-badge--running'          },
  passed:           { key: 'passed',           cls: 'sess-badge--passed'           },
  passed_unstable:  { key: 'passedUnstable',   cls: 'sess-badge--passed-unstable'  },
  failed:           { key: 'failed',           cls: 'sess-badge--failed'           },
  blocked:          { key: 'blocked',          cls: 'sess-badge--blocked'          },
  stopped:          { key: 'stopped',          cls: 'sess-badge--stopped'          },
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const cfg = BADGE_CFG[status]
  const label = cfg ? t(`runnerSession.badge.${cfg.key}`) : status
  return (
    <span className={`sess-badge ${cfg?.cls ?? 'sess-badge--blocked'}`}>
      {label}
      {status === 'passed_unstable' && <span className="sess-badge-warn-dot" />}
    </span>
  )
}

// ── Unified step shape ────────────────────────────────────────────────────

type RawAction = { name: string; input: Record<string, unknown> }

interface UiStep {
  num: number
  summary: string
  nextGoal?: string
  url?: string
  status: 'ok' | 'warning' | 'error' | 'current' | 'blocked'
  elapsedSec?: number
  screenshotB64?: string
  screenshotUrl?: string
  action?: ActionDetail
  rawActions?: RawAction[]
  toolResults?: string[]
  instabilityFlags?: string[]
  isRetry?: boolean
  wasRetried?: boolean
  retryErrorMsg?: string
}

// Warn patterns from tool results / eval text
const WARN_EVAL_RE = /0 matches|not visible|element not found|no element|could not find|no match|failed to find|not found on|does not exist/i

function deriveEvalStatus(
  rawStatus: 'ok' | 'error',
  summary: string,
  toolResults?: string[],
): 'ok' | 'warning' | 'error' {
  if (rawStatus === 'error') return 'error'
  const text = [summary, ...(toolResults ?? [])].join('\n')
  if (summary.includes('❔') || WARN_EVAL_RE.test(text)) return 'warning'
  return 'ok'
}

// Keywords indicating agent instability / retry behavior
const INSTABILITY_KEYWORDS = [
  'retry', 'retrying', 'try again', 'try another', 'try a different',
  'investigate', 'investigating',
  'wait for', 'waiting for', 'wait until',

]

function detectLiveInstabilityFlags(
  nextGoal: string,
  actions?: Array<{ name: string }>,
): string[] {
  const flags: string[] = []
  if (nextGoal) {
    const lower = nextGoal.toLowerCase()
    if (INSTABILITY_KEYWORDS.some(kw => lower.includes(kw))) {
      flags.push('retry_keyword')
    }
  }
  if (actions?.length && actions.every(a => a.name === 'wait' || a.name === 'scroll')) {
    flags.push('idle_loop')
  }
  return flags
}

function processUiSteps(steps: UiStep[]): UiStep[] {
  // 1. Add duplicate-goal / duplicate-summary flags
  let result = steps.map((step, i) => {
    const prevSummary = i > 0 ? cleanSummary(steps[i - 1].summary) : ''
    const curSummary = cleanSummary(step.summary)
    if (i > 0 && curSummary && curSummary === prevSummary) {
      const flags = step.instabilityFlags || []
      if (!flags.includes('duplicate_next_goal')) {
        return { ...step, instabilityFlags: [...flags, 'duplicate_next_goal'] }
      }
    }
    return step
  })
  // 2. Mark wasRetried on step before a retry step
  result = result.map((step, i) => {
    if (result[i + 1]?.isRetry) {
      return { ...step, wasRetried: true }
    }
    return step
  })
  return result
}

function liveActionToDetail(actions: WsStepEvent['actions']): ActionDetail | undefined {
  if (!actions?.length) return undefined
  const first = actions[0]
  return {
    type: first.name,
    target: (first.input?.url as string)
      || (first.input?.text as string)
      || (first.input?.index != null ? `#${first.input.index}` : undefined),
    args: first.input?.keys != null
      ? [String(first.input.keys)]
      : first.input?.seconds != null
        ? [`${first.input.seconds}s`]
        : undefined,
    result_message: undefined,
  }
}

function stepFromLive(e: WsStepEvent, t: TFunction): UiStep {
  const summary = e.summary || e.next_goal || t('runnerSession.stepFallback', { num: e.step })
  const action = liveActionToDetail(e.actions) || e.action
  const rawStatus: 'ok' | 'error' = e.status === 'error' ? 'error' : 'ok'
  return {
    num: e.step,
    summary,
    nextGoal: e.next_goal || undefined,
    url: e.url || undefined,
    status: deriveEvalStatus(rawStatus, summary),
    elapsedSec: e.elapsed_sec,
    screenshotB64: e.screenshot_b64,
    action,
    rawActions: e.actions as RawAction[] | undefined,
    instabilityFlags: detectLiveInstabilityFlags(e.next_goal, e.actions),
  }
}

const DONE_GOAL_RE = /\bdone\s*\(\s*\)/i

const SKIP_ACTIONS = new Set(['done', 'write_file', 'replace_file', 'read_file'])

function fmtAction(a: RawAction, t: TFunction): string {
  const i = a.input
  switch (a.name) {
    case 'navigate':    return t('runnerSession.actionFmt.navigate', { url: String(i.url ?? '').replace(/^https?:\/\//, '').slice(0, 55) })
    case 'input':       return t('runnerSession.actionFmt.input', { text: String(i.text ?? '').slice(0, 40) })
    case 'click': {
      const target = i.xpath ? String(i.xpath).slice(0, 45) : (i.index != null ? `#${i.index}` : '')
      return target ? t('runnerSession.actionFmt.clickTarget', { target }) : t('runnerSession.actionFmt.click')
    }
    case 'wait':        return t('runnerSession.actionFmt.wait', { seconds: i.seconds })
    case 'scroll': {
      const amt = i.amount != null ? ` ${i.amount}px` : ''
      return t('runnerSession.actionFmt.scroll', { value: `${i.direction ?? ''}${amt}` })
    }
    case 'evaluate': {
      const code = String(i.code ?? '').trim().slice(0, 60)
      return code ? t('runnerSession.actionFmt.evalCode', { code }) : t('runnerSession.actionFmt.evaluate')
    }
    case 'extract': {
      const q = String(i.query ?? '').slice(0, 45)
      return q ? t('runnerSession.actionFmt.extractQuery', { query: q }) : t('runnerSession.actionFmt.extract')
    }
    case 'search_page': return t('runnerSession.actionFmt.search', { query: String(i.query ?? '').slice(0, 40) })
    case 'send_keys':   return t('runnerSession.actionFmt.sendKeys', { keys: String(i.keys ?? '') })
    case 'go_back':     return t('runnerSession.actionFmt.goBack')
    default:            return a.name
  }
}

function fmtDoneSummary(raw: string): string {
  return raw
    .replace(/^(passed|failed|blocked|stopped|success|failure)[,;:\s]+/i, '')
    .replace(/[.,;]?\s*Verdict:\s*\w+\.?\s*$/i, '')
    .replace(/\*\*/g, '')
    .trim()
    .split('\n')[0]
    .trim()
}

function isDoneStep(h: HistoricalStep): boolean {
  if (h.summary === 'done') return true
  if (h.next_goal && DONE_GOAL_RE.test(h.next_goal)) return true
  const actions = (h as unknown as { actions?: Array<{ name: string }> }).actions
  if (actions?.some(a => a.name === 'done')) return true
  return false
}

function stepFromHistory(h: HistoricalStep, t: TFunction): UiStep {
  const toolResults = (h.results ?? [])
    .map(r => r.content)
    .filter((c): c is string => !!c)
  const rawStatus: 'ok' | 'error' = h.status === 'error' ? 'error' : 'ok'
  return {
    num: h.step,
    summary: h.summary || h.next_goal || t('runnerSession.stepFallback', { num: h.step }),
    nextGoal: h.next_goal || undefined,
    url: h.url || undefined,
    status: deriveEvalStatus(rawStatus, h.summary || '', toolResults.length > 0 ? toolResults : undefined),
    elapsedSec: h.duration_sec ?? undefined,
    screenshotUrl: h.screenshot?.url,
    action: h.action,
    rawActions: h.actions,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    instabilityFlags: h.instability_flags,
    isRetry: h.is_retry,
    retryErrorMsg: h.retry_error_msg,
  }
}

// ── Timeline step (compact accordion row) ────────────────────────────────

function RowIcon({ status }: { status: UiStep['status'] }) {
  if (status === 'current') return <Loader2 size={11} className="spin-icon" />
  if (status === 'error') return <X size={11} strokeWidth={2.5} />
  if (status === 'blocked' || status === 'warning') return <AlertTriangle size={11} strokeWidth={2.5} />
  return <Check size={11} strokeWidth={2.5} />
}

function TimelineStep({
  step, isLast, highlighted, stepRef, expanded, onToggle,
}: {
  step: UiStep
  isLast: boolean
  highlighted?: boolean
  stepRef?: (el: HTMLDivElement | null) => void
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const isCurrent = step.status === 'current'
  const stateKey = step.status

  const allActions = step.rawActions ?? []
  const visibleActions = allActions.filter(a => !SKIP_ACTIONS.has(a.name))
  const _hasDone = allActions.some(a => a.name === 'done')

  const cleanedSummary = cleanSummary(step.summary)
  const cleanedGoal = step.nextGoal ? cleanSummary(step.nextGoal) : ''
  const showIntention = !!cleanedGoal && cleanedGoal !== cleanedSummary
  const hasToolResults = (step.toolResults?.length ?? 0) > 0
  const showEval = !!step.summary && step.summary !== step.nextGoal

  const hasDetails = showIntention
    || visibleActions.length > 0
    || hasToolResults
    || (!!step.isRetry && !!step.retryErrorMsg)
    || showEval

  const rowLabel = cleanedSummary || cleanedGoal || t('runnerSession.stepFallback', { num: step.num })

  return (
    <div
      ref={stepRef}
      className={`tl-step tl-step--${stateKey}${highlighted ? ' tl-step--hl' : ''}`}
    >
      {/* Compact row */}
      <div
        className={`tl-row${hasDetails && !isCurrent ? ' tl-row--clickable' : ''}${expanded ? ' tl-row--open' : ''}`}
        onClick={hasDetails && !isCurrent ? onToggle : undefined}
        role={hasDetails && !isCurrent ? 'button' : undefined}
        tabIndex={hasDetails && !isCurrent ? 0 : undefined}
        onKeyDown={hasDetails && !isCurrent ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
        } : undefined}
        aria-expanded={hasDetails && !isCurrent ? expanded : undefined}
      >
        <span className="tl-row-icon"><RowIcon status={step.status} /></span>
        <span className="tl-row-num">{step.num}</span>
        <span className="tl-row-label">{rowLabel}</span>
        <span className="tl-row-right">
          {step.wasRetried && <span className="tl-row-retried-dot" title={t('runnerSession.retriedTitle')} />}
          {step.isRetry && <span className="tl-row-retry-chip">&#x21A9; {t('runnerSession.retry')}</span>}
          {step.elapsedSec != null && step.elapsedSec >= 1 && (
            <span className="tl-row-time">{fmtSecShort(step.elapsedSec, t)}</span>
          )}
          {hasDetails && !isCurrent && (
            <ChevronRight size={10} className={`tl-row-chevron${expanded ? ' open' : ''}`} />
          )}
        </span>
      </div>

      {/* Accordion detail pane */}
      {hasDetails && (
        <div className={`tl-detail${expanded ? ' tl-detail--open' : ''}`}>
          <div className="tl-detail-inner">
            <div className="tl-detail-body">
              {step.isRetry && step.retryErrorMsg && (
                <div className="tl-detail-row tl-detail-row--warn">
                  <span className="tl-dl">{t('runnerSession.detail.previous')}</span>
                  <span className="tl-dv">{step.retryErrorMsg}</span>
                </div>
              )}
              {showIntention && (
                <div className="tl-detail-row">
                  <span className="tl-dl">{t('runnerSession.detail.intention')}</span>
                  <span className="tl-dv">{cleanedGoal}</span>
                </div>
              )}
              {visibleActions.length > 0 && (
                <div className="tl-detail-row tl-detail-row--top">
                  <span className="tl-dl">{t('runnerSession.detail.action')}</span>
                  <div className="tl-dv-actions">
                    {visibleActions.map((a, i) => (
                      <div key={i} className="tl-dv-action">
                        <span className="tl-dv-atype">{a.name}</span>
                        <span className="tl-dv-aval">{fmtAction(a, t)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasToolResults && (
                <div className="tl-detail-row tl-detail-row--top">
                  <span className="tl-dl">{t('runnerSession.detail.result')}</span>
                  <div className="tl-dv-results">
                    {(step.toolResults ?? []).map((r, i) => (
                      <span key={i} className="tl-dv-result">{r || '—'}</span>
                    ))}
                  </div>
                </div>
              )}
              {showEval && (
                <div className="tl-detail-row">
                  <span className="tl-dl">{t('runnerSession.detail.eval')}</span>
                  <span className={`tl-dv tl-dv-eval--${stateKey}`}>{step.summary}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!isLast && <div className="tl-connector" />}
    </div>
  )
}

// ── Pending ghost step ────────────────────────────────────────────────────

function PendingStep({ num }: { num: number }) {
  const { t } = useTranslation()
  return (
    <div className="tl-step tl-step--pending">
      <div className="tl-row">
        <span className="tl-row-icon">
          <Loader2 size={11} className="spin-icon" />
        </span>
        <span className="tl-row-num">{num}</span>
        <span className="tl-row-label tl-row-label--pending">{t('runnerSession.waitingForModel')}</span>
      </div>
    </div>
  )
}

// ── Steps feed ────────────────────────────────────────────────────────────

// ── Result banner ─────────────────────────────────────────────────────────────

function ResultBanner({ summary, status }: { summary: string; status: string }) {
  const { t } = useTranslation()
  const cleaned = fmtDoneSummary(summary)
  if (!cleaned) return null
  const isOk = status === 'passed' || status === 'passed_unstable'
  const isErr = status === 'failed'
  const cls = isOk ? 'rb--ok' : isErr ? 'rb--err' : 'rb--warn'
  const Icon = isOk ? Check : isErr ? X : AlertTriangle
  return (
    <div className={`steps-result-banner ${cls}`}>
      <span className="rb-icon"><Icon size={12} strokeWidth={2.5} /></span>
      <span className="rb-text">{cleaned || <em style={{ opacity: 0.5 }}>{t('runnerSession.noData')}</em>}</span>
    </div>
  )
}


function StepsFeed({
  running, steps, pendingStepNum, highlightedStep, stepRefs,
  doneSummary, doneResultStatus,
}: {
  running: boolean
  steps: UiStep[]
  pendingStepNum?: number | null
  highlightedStep?: number | null
  stepRefs: React.MutableRefObject<Map<number, HTMLDivElement>>
  doneSummary?: string | null
  doneResultStatus?: string | null
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)

  function handleToggle(num: number) {
    setExpandedStep(prev => prev === num ? null : num)
  }

  const successCount = steps.filter(s => s.status === 'ok').length
  const warningCount = steps.filter(s => s.status === 'warning').length
  const errorCount = steps.filter(s => s.status === 'error').length
  const totalCount = steps.length

  useEffect(() => {
    if (running && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [steps.length, pendingStepNum, running])

  return (
    <div className="session-steps-panel">
      <div className="steps-summary-bar">
        <span className="steps-summary-total">
          {totalCount > 0
            ? pluralSteps(totalCount, t)
            : (running ? t('runnerSession.runningEllipsis') : t('runnerSession.noSteps'))}
        </span>
        {totalCount > 0 && (
          <>
            {successCount > 0 && <span className="steps-chip steps-chip--ok">&#x2713; {successCount}</span>}
            {warningCount > 0 && <span className="steps-chip steps-chip--warn">&#x26A0; {warningCount}</span>}
            {errorCount > 0 && <span className="steps-chip steps-chip--err">&#x2717; {errorCount}</span>}
          </>
        )}
        {running && pendingStepNum != null && (
          <span className="steps-chip steps-chip--running">
            <Loader2 size={9} className="spin-icon" />
          </span>
        )}
      </div>

      {!running && doneSummary && doneResultStatus && (
        <ResultBanner summary={doneSummary} status={doneResultStatus} />
      )}
      <div className="tl-scroll" ref={scrollRef}>
        {running && steps.length === 0 && (
          <div className="steps-waiting">
            <div className="steps-dots"><span /><span /><span /></div>
            <span className="steps-waiting-lbl">{t('runnerSession.waitingForSteps')}</span>
          </div>
        )}
        {steps.map((s, idx) => (
          <TimelineStep
            key={`${s.num}-${s.status}`}
            step={s}
            isLast={!pendingStepNum && idx === steps.length - 1 && running}
            highlighted={highlightedStep === s.num}
            expanded={expandedStep === s.num}
            onToggle={() => handleToggle(s.num)}
            stepRef={el => {
              if (el) stepRefs.current.set(s.num, el)
              else stepRefs.current.delete(s.num)
            }}
          />
        ))}
        {running && pendingStepNum != null && <PendingStep num={pendingStepNum} />}
      </div>
    </div>
  )
}
// ── View tabs ─────────────────────────────────────────────────────────────

type ViewTab = 'screen' | 'logs'

function ViewportTabFloat({
  active, onChange, logCount,
}: {
  active: ViewTab
  onChange: (tab: ViewTab) => void
  logCount: number
}) {
  const { t } = useTranslation()
  return (
    <div className="vft-pill">
      <button
        type="button"
        className={`vft-btn${active === 'screen' ? ' vft-btn--active' : ''}`}
        onClick={() => onChange('screen')}
      >
        <Monitor size={11} />
        {t('runnerSession.tabs.screen')}
      </button>
      <button
        type="button"
        className={`vft-btn${active === 'logs' ? ' vft-btn--active' : ''}`}
        onClick={() => onChange('logs')}
      >
        <Terminal size={11} />
        {t('runnerSession.tabs.logs')}
        {logCount > 0 && (
          <span className="vft-count">{logCount > 999 ? '999+' : logCount}</span>
        )}
      </button>
    </div>
  )
}

// ── Video player ──────────────────────────────────────────────────────────

function VideoPlayer({ url }: { url: string }) {
  const { t } = useTranslation()
  const [err, setErr] = useState(false)
  if (err) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: 0.45, height: '100%', justifyContent: 'center' }}>
        <Monitor size={22} style={{ color: 'rgba(255,255,255,0.4)' }} />
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{t('runnerSession.video.unavailable')}</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: '#000' }}>
      <video
        src={url}
        controls
        preload="auto"
        style={{ maxWidth: '100%', maxHeight: '100%', outline: 'none' }}
        onError={() => setErr(true)}
      />
    </div>
  )
}

// ── Log category color map ────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  agent:     '#A78BFA',
  tools:     '#60A5FA',
  runner:    '#34D399',
  preflight: '#FCD34D',
  tokens:    '#94A3B8',
  summary:   '#FB923C',
  lifecycle: '#64748B',
}
function catColor(cat: string) {
  return CAT_COLORS[cat] ?? '#34D399'
}

// ── Log filtering ─────────────────────────────────────────────────────────

// Suppress developer noise that is never useful to the user
const ALWAYS_HIDDEN_RE = /newer version available|upgrade with:|uv add browser-use|anonymous usage|telemetry\.browser-use|BrowserProfile\(|Loading extension|Installing extension|viewport.*device scale|device_scale_factor/i

function filterLog(log: WsLogEvent): boolean {
  return !ALWAYS_HIDDEN_RE.test(log.message)
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
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  const sessionLogs = logs.filter(l => l.source === 'session')
  const visible = sessionLogs.filter(filterLog)

  // First runner config log (model · browser · steps)
  const configLog = visible.find(l => l.category === 'runner' && (l.message.startsWith('Модель:') || l.message.startsWith('Model:')))

  useEffect(() => {
    if (running && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visible.length, running])

  function emptyMessage() {
    if (logsLoading) return t('runnerSession.logs.loading')
    if (running)     return t('runnerSession.logs.willAppear')
    if (isCompleted) return t('runnerSession.logs.notSaved')
    return t('runnerSession.logs.none')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar: config info */}
      {configLog && (
        <div className="logs-topbar">
          <div className="logs-config-card logs-config-card--inline">
            {configLog.message.split(' · ').map((part, i) => (
              <span key={i} className="logs-config-part">{part}</span>
            ))}
          </div>
        </div>
      )}

      {/* Log lines */}
      <div className="session-logs-scroll" ref={scrollRef}>
        {visible.length === 0 ? (
          <div className="session-logs-empty">
            {logsLoading
              ? <><Loader2 size={13} className="spin-icon" style={{ display: 'inline-block', marginRight: 6 }} /> {t('runnerSession.logs.loading')}</>
              : emptyMessage()}
          </div>
        ) : (
          visible.map((log, i) => {
            const cc = catColor(log.category)
            return (
              <div
                key={i}
                className={`session-log-line session-log--${log.level}`}
              >
                <span className="session-log-time">{fmtSecShort(Math.round(log.elapsed_sec), t)}</span>
                <span className="session-log-cat" style={{ color: log.level === 'error' ? '#F87171' : cc }}>
                  {log.category}
                </span>
                <span className="session-log-msg">{log.message}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}




function humanizeBlockedSummary(summary: string, t: TFunction): string {
  const lower = summary.toLowerCase()
  if (lower.includes('captcha')) return t('runnerSession.blockedReason.captcha')
  if (lower.includes('2fa') || lower.includes('two-factor') || lower.includes('mfa')) return t('runnerSession.blockedReason.twoFactor')
  if (lower.includes('preflight') || lower.includes('not accessible')) return t('runnerSession.blockedReason.preflight')
  return t('runnerSession.blockedReason.generic')
}

// ── Session footer ────────────────────────────────────────────────────────

function SessionFooter({
  doneEvent, failedStepNum, stepsCount, displayStatus, retryStepCount, onScrollToStep,
}: {
  doneEvent: WsDoneEvent
  failedStepNum?: number | null
  stepsCount?: number
  displayStatus?: string
  retryStepCount?: number
  onScrollToStep?: (stepNum: number) => void
}) {
  const { t } = useTranslation()
  const effectiveStatus = displayStatus ?? doneEvent.status
  const showReason = (doneEvent.status === 'failed' || doneEvent.status === 'blocked' || doneEvent.status === 'stopped') && doneEvent.summary
  const reasonText = doneEvent.status === 'blocked'
    ? humanizeBlockedSummary(doneEvent.summary, t)
    : doneEvent.summary
  const unstableReason = effectiveStatus === 'passed_unstable' && retryStepCount
    ? t('runnerSession.requiredRetry', { count: retryStepCount })
    : null
  return (
    <div className="session-footer">
      <div className="session-footer-info">
        <StatusBadge status={effectiveStatus} />
        <span className="session-footer-div" />
        <Clock size={12} strokeWidth={1.75} style={{ color: 'var(--tx-dim)', flexShrink: 0 }} />
        <span className="session-footer-meta">{fmtSec(Math.round(doneEvent.duration_sec))}</span>
        <span className="session-footer-div" />
        <span className="session-footer-meta">{pluralSteps(stepsCount ?? doneEvent.steps_count, t)}</span>
        {unstableReason && (
          <>
            <span className="session-footer-div" />
            <span className="session-footer-reason">{unstableReason}</span>
          </>
        )}
        {showReason && (
          <>
            <span className="session-footer-div" />
            {failedStepNum != null && onScrollToStep && (
              <button
                type="button"
                className="session-footer-step-link"
                onClick={() => onScrollToStep(failedStepNum)}
              >
                {t('runnerSession.stepFallback', { num: failedStepNum })}
              </button>
            )}
            <span className="session-footer-reason" title={doneEvent.summary}>{reasonText}</span>
          </>
        )}
        {doneEvent.errors.length > 0 && doneEvent.errors[0] !== doneEvent.summary && (
          <>
            <span className="session-footer-div" />
            <span className="session-footer-error-list">
              {doneEvent.errors.slice(0, 3).join(' · ')}
            </span>
          </>
        )}
      </div>
    </div>
  )
}


// ── RunnerSessionView ─────────────────────────────────────────────────────

export interface RunnerSessionViewProps {
  session: RunnerSession
  onBack: () => void
  onUpdate: (update: Partial<RunnerSession>) => void
  wsPathPrefix?: string
  stepsApiPath?: string
  externalRunId?: string
}

export function RunnerSessionView({ session, onBack, onUpdate, wsPathPrefix, stepsApiPath, externalRunId }: RunnerSessionViewProps) {
  const { t } = useTranslation()
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t })
  const [liveSteps, setLiveSteps] = useState<WsStepEvent[]>([])
  const [pendingStepNum, setPendingStepNum] = useState<number | null>(null)
  const [logEvents, setLogEvents] = useState<WsLogEvent[]>([])
  const [historicalSteps, setHistoricalSteps] = useState<HistoricalStep[] | null>(null)
  const [historicalLogs, setHistoricalLogs] = useState<WsLogEvent[] | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [doneEvent, setDoneEvent] = useState<WsDoneEvent | null>(
    session.result
      ? {
          type: 'done',
          status: session.result.status,
          summary: session.result.summary,
          duration_sec: session.result.duration_sec,
          steps_count: session.result.steps_count,
          instability_step_count: session.result.instability_step_count,
          retry_step_count: session.result.retry_step_count,
          errors: session.result.errors,
          run_id: session.result.run_id,
        }
      : null
  )
  const [wsError, setWsError] = useState<string | null>(null)
  const [startTime] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [viewTab, setViewTab] = useState<ViewTab>('screen')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoUnavailable, setVideoUnavailable] = useState(false)
  const [highlightedStep, setHighlightedStep] = useState<number | null>(null)
  const [hasLiveFrame, setHasLiveFrame] = useState(false)
  const liveFrameRef = useRef<HTMLImageElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onUpdateRef = useRef(onUpdate)
  const mountedRef = useRef(true)
  const activeRunIdRef = useRef<string | null>(null)
  const stepRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { onUpdateRef.current = onUpdate })

  // doneEvent === null means run is still in progress (even if session.status briefly lags)
  const isRunning = session.status === 'running' && doneEvent === null

  // Check for video recording after run completes; retry because video is finalized async
  useEffect(() => {
    const runId = doneEvent?.run_id
    if (!runId) return
    let cancelled = false
    const MAX_ATTEMPTS = 30 // 60s total
    const check = (attempt: number) => {
      fetch(`/api/runner/sessions/${runId}/video`, { method: 'HEAD' })
        .then(r => {
          if (cancelled) return
          if (r.ok) {
            setVideoUrl(`/api/runner/sessions/${runId}/video`)
          } else if (attempt < MAX_ATTEMPTS) {
            setTimeout(() => check(attempt + 1), 2000)
          } else {
            setVideoUnavailable(true)
          }
        })
        .catch(() => {
          if (cancelled) return
          if (attempt < MAX_ATTEMPTS) {
            setTimeout(() => check(attempt + 1), 2000)
          } else {
            setVideoUnavailable(true)
          }
        })
    }
    check(0)
    return () => { cancelled = true }
  }, [doneEvent?.run_id])

  const handleStop = async () => {
    const runId = activeRunIdRef.current
    if (!runId) return
    try {
      await fetch(`/api/runner/sessions/${runId}/stop`, { method: 'POST' })
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 500)
    return () => clearInterval(id)
  }, [isRunning, startTime])

  useEffect(() => {
    if (session.status !== 'running' && session.result?.run_id && !historicalSteps) {
      let cancelled = false
      const runId = session.result.run_id
      const path = stepsApiPath ?? `/runner/sessions/${runId}/steps`
      fetch(`/api${path}`)
        .then(res => res.json() as Promise<{ steps: HistoricalStep[] }>)
        .then(data => { if (!cancelled) setHistoricalSteps(data.steps ?? []) })
        .catch(() => { if (!cancelled) setHistoricalSteps([]) })

      // Load historical logs
      if (historicalLogs === null) {
        setLogsLoading(true)
        fetch(`/api/runner/sessions/${runId}/logs`)
          .then(res => res.json() as Promise<{ logs: Array<{ level: string; category: string; message: string; elapsed_sec: number }> }>)
          .then(data => {
            if (cancelled) return
            setHistoricalLogs(data.logs.map(l => ({ ...l, type: 'log' as const, level: l.level as WsLogEvent['level'], source: 'session' as const })))
          })
          .catch(() => { if (!cancelled) setHistoricalLogs([]) })
          .finally(() => { if (!cancelled) setLogsLoading(false) })
      }
      return () => { cancelled = true }
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
          const language = i18n.language === 'en' ? 'en' : 'ru'
          const body = session.source === 'manual'
            ? {
                task: session.task!,
                start_url: session.startUrl,
                language,
                ...(session.sensitiveData ? { sensitive_data: session.sensitiveData } : {}),
                ...(session.browserProfile ? { browser_profile: session.browserProfile } : {}),
              }
            : { work_item_id: session.workItemId!, iteration_index: session.iterationIndex ?? 0, language }

          const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abort.signal,
          })
          if (!res.ok) {
            let detail = tRef.current('runnerSession.wsErrors.httpError', { status: res.status })
            try { const err = await res.json(); detail = err.detail || detail } catch { /* use status */ }
            throw new Error(detail)
          }
          const data = await res.json() as { run_id: string }
          runId = data.run_id
        }

        if (abort.signal.aborted || !mountedRef.current) return
        activeRunIdRef.current = runId

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
            const se = event as WsStepEvent
            setLiveSteps(prev => {
              const filtered = prev.filter(s => s.step !== se.step)
              return [...filtered, se].sort((a, b) => a.step - b.step)
            })
            setPendingStepNum(prev => (prev === se.step ? null : prev))
          } else if (event.type === 'step_update') {
            const upd = event as WsStepUpdateEvent
            setLiveSteps(prev => prev.map(s =>
              s.step === upd.step
                ? { ...s, summary: upd.summary, ...(upd.status ? { status: upd.status } : {}) }
                : s
            ))
          } else if (event.type === 'step_pending') {
            const pend = event as WsStepPendingEvent
            setPendingStepNum(pend.step)
          } else if (event.type === 'log') {
            setLogEvents(prev => [...prev, event as WsLogEvent])
          } else if (event.type === 'done') {
            receivedDone = true
            setPendingStepNum(null)
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
          } else if (event.type === 'frame') {
            const frameData = (event as WsFrameEvent).data
            if (liveFrameRef.current) {
              // Auto-detect format: JPEG starts with /9j/, PNG with iVBORw0KGgo
              const mime = frameData.startsWith('/9j/') ? 'image/jpeg' : 'image/png'
              liveFrameRef.current.src = `data:${mime};base64,${frameData}`
            }
            setHasLiveFrame(true)
          } else if (event.type === 'error') {
            receivedDone = true
            setWsError((event as { type: string; message: string }).message)
            onUpdateRef.current({ status: 'blocked', endedAt: Date.now() })
          }
        }

        ws.onclose = () => {
          if (!mountedRef.current || receivedDone) return
          setWsError(tRef.current('runnerSession.wsErrors.connectionLost'))
          onUpdateRef.current({ status: 'blocked', endedAt: Date.now() })
        }

        ws.onerror = () => {
          if (!mountedRef.current) return
          receivedDone = true
          setWsError(tRef.current('runnerSession.wsErrors.connectionError'))
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
      activeRunIdRef.current = null
      setHasLiveFrame(false)
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [isRunning, externalRunId, session.source, session.task, session.workItemId, session.iterationIndex, session.startUrl])

  // Build display steps — filter done marker, add duplicate-goal flags + retry markers
  const uiSteps: UiStep[] = (() => {
    const base = historicalSteps
      ? historicalSteps.filter(h => !isDoneStep(h)).map(h => stepFromHistory(h, t))
      : liveSteps
          .filter(s => {
            if (DONE_GOAL_RE.test(s.next_goal || '')) return false
            const hasGoal = !!s.next_goal
            const hasMeaningfulSummary = !!s.summary && s.summary !== 'done'
            return hasGoal || s.status === 'error' || hasMeaningfulSummary
          })
          .map(s => stepFromLive(s, t))
    const processed = processUiSteps(base)
    // Mark the last step as 'current' during execution
    if (isRunning && processed.length > 0) {
      processed[processed.length - 1] = { ...processed[processed.length - 1], status: 'current' }
    }
    // Mark last step as 'blocked' when session ended blocked (not an actual error)
    if (!isRunning && doneEvent?.status === 'blocked' && processed.length > 0) {
      const last = processed[processed.length - 1]
      if (last.status === 'ok' || last.status === 'warning') {
        processed[processed.length - 1] = { ...last, status: 'blocked' }
      }
    }
    return processed
  })()

  const isCompleted = !isRunning
  const failedStepNum = uiSteps.find(s => s.status === 'error')?.num ?? null

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

  const hasErrorSteps = uiSteps.some(s => s.status === 'error')
  const hasWarningSteps = uiSteps.some(s => s.status === 'warning')
  const hasRetrySteps = uiSteps.some(s => s.isRetry)
  const baseStatus = doneEvent?.status ?? session.result?.status ?? session.status
  const displayStatus: string = (
    !isRunning &&
    baseStatus === 'passed' &&
    (hasWarningSteps || hasErrorSteps || hasRetrySteps)
  ) ? 'passed_unstable' : baseStatus

  // Strip domain from title for cleaner display
  const headerTitle = session.title.replace(/\s*·\s*\S+\.\S+.*$/, '')

  return (
    <div className="session-layout">

      {/* Header */}
      <div className="session-hdr">
        <div className="session-hdr-left">
          <button type="button" className="back-btn" onClick={onBack}>
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <span className="session-title-txt" title={session.title}>{headerTitle}</span>
        </div>
        <div className="session-hdr-right">
          {isRunning && <span className="session-timer-dot" aria-hidden="true" />}
          <span className={`session-timer-num${isRunning ? ' session-timer-num--live' : ''}`}>{fmtSec(displayTime)}</span>
          <span className="session-hdr-div" />
          <StatusBadge status={isRunning ? 'running' : (displayStatus)} />
          {isRunning && (
            <button type="button" className="session-stop-btn" onClick={handleStop}>
              <Square size={11} strokeWidth={2} /> {t('runnerSession.stop')}
            </button>
          )}
        </div>
      </div>

      {/* Unified workspace block */}
      <div className="session-workspace">

        {/* Body: viewport + steps */}
        <div className="session-body">
          <div className="session-viewport-zone">
            {/* Tab bar — fixed at top of zone */}
            {(() => {
              const rawLogs = isCompleted && historicalLogs !== null ? historicalLogs : logEvents
              const filteredCount = rawLogs.filter(l => l.source === 'session' && filterLog(l)).length
              return (
                <ViewportTabFloat
                  active={viewTab}
                  onChange={setViewTab}
                  logCount={filteredCount}
                />
              )
            })()}

            {/* Content panels — stacked below tab bar */}
            <div className="vp-content-area">
              {/* Screen tab */}
              <div className={`session-vp-panel${viewTab === 'screen' ? ' session-vp-panel--visible' : ''}`}>
                {isRunning ? (
                  <div className="session-live-viewport">
                    <img
                      ref={liveFrameRef}
                      className="session-live-frame"
                      style={{ display: hasLiveFrame ? 'block' : 'none' }}
                      alt=""
                    />
                    {!hasLiveFrame && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: 0.35 }}>
                        <Loader2 size={22} className="spin-icon" style={{ color: 'rgba(255,255,255,0.5)' }} />
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{t('runnerSession.connectingToBrowser')}</div>
                      </div>
                    )}
                    {hasLiveFrame && (
                      <div className="session-live-hud">
                        <span className="session-live-badge">● {t('runnerSession.live')}</span>
                        {uiSteps.length > 0 && (
                          <div className="session-live-caption">
                            {t('runnerSession.liveCaption', {
                              num: uiSteps[uiSteps.length - 1].num,
                              summary: cleanSummary(uiSteps[uiSteps.length - 1].summary),
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : videoUrl ? (
                  <VideoPlayer url={videoUrl} />
                ) : videoUnavailable ? (
                  <div className="session-viewport-inner" style={{ flexDirection: 'column', gap: 10, opacity: 0.4 }}>
                    <Monitor size={22} style={{ color: 'rgba(255,255,255,0.3)' }} />
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>{t('runnerSession.video.notSaved')}</div>
                  </div>
                ) : (
                  <div className="session-viewport-inner" style={{ flexDirection: 'column', gap: 10, opacity: 0.4 }}>
                    <Loader2 size={22} className="spin-icon" style={{ color: 'rgba(255,255,255,0.3)' }} />
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>{t('runnerSession.video.processing')}</div>
                  </div>
                )}
              </div>

              {/* Logs tab */}
              <div className={`session-vp-panel${viewTab === 'logs' ? ' session-vp-panel--visible' : ''}`}>
                <LogsPane
                  logs={isCompleted && historicalLogs !== null ? historicalLogs : logEvents}
                  running={isRunning}
                  isCompleted={isCompleted}
                  logsLoading={logsLoading}
                />
              </div>
            </div>
          </div>
          <StepsFeed
            running={isRunning}
            steps={uiSteps}
            pendingStepNum={pendingStepNum}
            highlightedStep={highlightedStep}
            stepRefs={stepRefs}
            doneSummary={!isRunning ? (doneEvent?.summary || session.result?.summary || null) : null}
            doneResultStatus={!isRunning ? (doneEvent?.status || session.result?.status || null) : null}
          />
        </div>

      </div>

      {/* WS error banner */}
      {wsError && !isRunning && (
        <div className="session-ws-error">
          <X size={14} strokeWidth={1.75} />
          {wsError}
        </div>
      )}

    </div>
  )
}
