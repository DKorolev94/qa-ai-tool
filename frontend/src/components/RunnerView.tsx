import { useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Loader2, Monitor, Play, Plus, Upload, XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { api, humanizeFetchError } from '../api'
import i18n from '../i18n'
import { RunnerSessionView, StatusBadge } from './RunnerSessionView'
import { SectionHeader } from './SectionHeader'
import type { BrowserProfileSettings, FetchResult, RunnerRunResponse, RunnerSession, SessionListItem, Step } from '../types'

// iPad Air, iPadOS 17 — mirrors the iPhone 14 preset already hardcoded in browser-use-runner/main.py
const _IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'

const DEVICE_PRESETS: Record<string, BrowserProfileSettings> = {
  mobile: { is_mobile: true },
  tablet: { is_mobile: true, viewport_width: 820, viewport_height: 1180, device_scale_factor: 2, user_agent: _IPAD_UA },
}

// ── Helpers ───────────────────────────────────────────────────────────────

type InputMode = 'testit' | 'manual'

function fmtElapsed(s: number, t: TFunction) {
  const m = Math.floor(s / 60)
  return m > 0
    ? t('runnerView.time.elapsedMinSec', { m, s: String(s % 60).padStart(2, '0') })
    : t('runnerView.time.elapsedSec', { s })
}

function mkSession(
  base: Pick<RunnerSession, 'title' | 'source'> &
    Partial<Pick<RunnerSession, 'id' | 'task' | 'startUrl' | 'workItemId' | 'iterationIndex' | 'forceRegenerate' | 'cacheAttempt' | 'sensitiveData' | 'browserProfile'>>
): RunnerSession {
  return {
    id: crypto.randomUUID(),
    status: 'running',
    startedAt: Date.now(),
    ...base,
  }
}

// ── Compact steps table (shared with TestItWorkbench) ─────────────────────

function StepBlock({ label, steps }: { label: string; steps?: Step[] | null }) {
  const { t } = useTranslation()
  if (!steps?.length) return null
  const hasTestData = steps.some(s => s.test_data)
  const cols = hasTestData ? '28px 1fr 1fr 1fr' : '28px 1fr 1fr'
  return (
    <div>
      <span className="case-sec-label">{label}</span>
      <div className="steps-tbl">
        <div className="steps-head" style={{ gridTemplateColumns: cols }}>
          <div className="steps-th steps-th-num">#</div>
          <div className="steps-th">{t('runnerView.steps.colAction')}</div>
          <div className="steps-th">{t('runnerView.steps.colExpected')}</div>
          {hasTestData && <div className="steps-th">{t('runnerView.steps.colTestData')}</div>}
        </div>
        {steps.map((s, i) => (
          <div key={i} className="steps-row" style={{ gridTemplateColumns: cols }}>
            <div className="steps-num-cell">{i + 1}</div>
            <div className="steps-cell steps-action">{s.action}</div>
            <div className="steps-cell steps-exp">{s.expected || ''}</div>
            {hasTestData && <div className="steps-cell">{s.test_data || ''}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── TestIT Workbench ──────────────────────────────────────────────────────

interface WorkbenchProps {
  fetchResult: FetchResult
  onBack: () => void
  onRun: (iterationIndex: number, forceRegenerate: boolean, browserProfile: BrowserProfileSettings) => Promise<void>
}

function IterationPicker({
  names, rows, selected, onChange,
}: {
  names: string[]
  rows: string[][]
  selected: number
  onChange: (i: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="source-label">{t('runnerView.iterationPicker.label')}</label>
      <select
        className="source-id-input"
        style={{ width: '100%', cursor: 'pointer' }}
        value={selected}
        onChange={e => onChange(Number(e.target.value))}
      >
        {rows.map((row, i) => {
          const label = names.map((n, j) => `${n}: ${row[j] ?? ''}`).join(' | ')
          return <option key={i} value={i}>{`[${i + 1}] ${label}`}</option>
        })}
      </select>
    </div>
  )
}

function TestItWorkbench({ fetchResult, onBack, onRun }: WorkbenchProps) {
  const { t } = useTranslation()
  const tc = fetchResult.normalized_testcase
  const pt = tc.parameter_table
  const hasIterations = pt && pt.rows.length > 1
  const [selectedIteration, setSelectedIteration] = useState(0)
  const [forceRegenerate, setForceRegenerate] = useState(false)
  const [locale, setLocale] = useState('ru-RU')
  const [device, setDevice] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const runBrowserProfile = (): BrowserProfileSettings => ({
    ...(locale ? { locale } : {}),
    ...(DEVICE_PRESETS[device] ?? {}),
  })
  const cacheOk = (tc.tags ?? []).includes('cache-ok')
  return (
    <div className="workspace-inner-wb">
      <SectionHeader title={t('sidebar.testRunner')} onBack={onBack} />

      <div className="wb-card">
        <div className="wb-card-left">
          <div className="wb-title">{tc.title || '—'}</div>
          <div className="wb-meta-row">
            <span className="wb-source-badge">TestIT</span>
            <span className="wb-source-id">#{fetchResult.work_item_id}</span>
            <span
              className={cacheOk ? 'wb-cache-badge wb-cache-badge-on hint' : 'wb-cache-badge wb-cache-badge-off hint'}
              tabIndex={0}
              data-tooltip={cacheOk ? t('runnerView.cacheOkHint') : t('runnerView.cacheMissingHint')}
            >
              {cacheOk ? t('runnerView.cacheOn') : t('runnerView.cacheOff')}
            </span>
          </div>
        </div>
        <div className="wb-actions">
          <div className="wb-setting-group">
            <span className="wb-setting-label">{t('runnerView.localeLabel')}</span>
            <select className="wb-locale-select" value={locale} onChange={e => setLocale(e.target.value)}>
              <option value="ru-RU">ru-RU</option>
              <option value="en-US">en-US</option>
            </select>
          </div>
          <div className="wb-setting-group">
            <span className="wb-setting-label">{t('runnerView.deviceLabel')}</span>
            <select className="wb-locale-select" value={device} onChange={e => setDevice(e.target.value)}>
              <option value="">{t('runnerView.deviceDesktop')}</option>
              <option value="mobile">{t('runnerView.deviceMobile')}</option>
              <option value="tablet">{t('runnerView.deviceTablet')}</option>
            </select>
          </div>
          <label className="wb-force-regen-label hint" tabIndex={0} data-tooltip={t('runnerView.forceRegenerateHint')}>
            <input
              type="checkbox"
              checked={forceRegenerate}
              onChange={e => setForceRegenerate(e.target.checked)}
            />
            {t('runnerView.forceRegenerate')}
          </label>
          <button
            type="button"
            className={`source-fetch-btn${starting ? ' source-fetch-btn-muted' : ''}`}
            disabled={starting}
            onClick={async () => {
              setStarting(true)
              setStartError(null)
              try {
                await onRun(selectedIteration, forceRegenerate, runBrowserProfile())
              } catch (err) {
                setStartError(humanizeFetchError((err as Error).message))
                setStarting(false)
              }
            }}
          >
            {starting
              ? <><Loader2 size={13} className="spin-icon" />{t('runnerView.loading')}</>
              : <><Play size={13} />{t('runnerView.run')}</>}
          </button>
        </div>
      </div>

      {startError && (
        <div className="alert alert-error">
          <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
          <span className="alert-text"><strong>{t('runnerView.errorPrefix')}</strong>{startError}</span>
        </div>
      )}

      <div className="wb-grid" style={{ flex: 1, minHeight: 0 }}>
        <div className="wb-main">
          <div className="wb-tabs-row">
            <div className="wb-tab wb-tab-active" style={{ cursor: 'default' }}>{t('runnerView.workbench.tabTestCase')}</div>
          </div>
          <div className="wb-content">
            <StepBlock label={t('runnerView.steps.precondition')} steps={tc.preconditions} />
            <div>
              <span className="case-sec-label">{t('runnerView.steps.label')}</span>
              {tc.steps?.length ? (() => {
                const hasTestData = tc.steps.some(s => s.test_data)
                const cols = hasTestData ? '28px 1fr 1fr 1fr' : '28px 1fr 1fr'
                return (
                  <div className="steps-tbl">
                    <div className="steps-head" style={{ gridTemplateColumns: cols }}>
                      <div className="steps-th steps-th-num">#</div>
                      <div className="steps-th">{t('runnerView.steps.colAction')}</div>
                      <div className="steps-th">{t('runnerView.steps.colExpected')}</div>
                      {hasTestData && <div className="steps-th">{t('runnerView.steps.colTestData')}</div>}
                    </div>
                    {tc.steps.map((s, i) => (
                      <div key={i} className="steps-row" style={{ gridTemplateColumns: cols }}>
                        <div className="steps-num-cell">{i + 1}</div>
                        <div className="steps-cell steps-action">{s.action}</div>
                        <div className="steps-cell steps-exp">{s.expected || ''}</div>
                        {hasTestData && <div className="steps-cell">{s.test_data || ''}</div>}
                      </div>
                    ))}
                  </div>
                )
              })() : (
                <div className="case-text-box case-text-empty">{t('runnerView.steps.notSpecified')}</div>
              )}
            </div>
            <StepBlock label={t('runnerView.steps.postcondition')} steps={tc.postconditions} />
            {hasIterations && pt && (
              <IterationPicker
                names={pt.names}
                rows={pt.rows}
                selected={selectedIteration}
                onChange={setSelectedIteration}
              />
            )}
          </div>
        </div>

        <div className="wb-run-hint">
          <Play size={28} strokeWidth={1.4} style={{ color: 'var(--tx-dim)' }} />
          <span>{t('runnerView.workbench.runHint')}</span>
        </div>
      </div>
    </div>
  )
}

// ── Run-history device/locale badge ──────────────────────────────────────

function historyConfigLabel(bp: BrowserProfileSettings | undefined, replayed: boolean | undefined, t: TFunction): string | null {
  const device = !bp
    ? null
    : !bp.is_mobile
      ? t('runnerView.deviceDesktop')
      : bp.viewport_width === 820 && bp.viewport_height === 1180
        ? t('runnerView.deviceTablet')
        : t('runnerView.deviceMobile')
  const parts = [device, bp?.locale, replayed ? t('runnerSession.replayedBadge') : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

// ── Date formatting ───────────────────────────────────────────────────────

function fmtDate(iso: string, t: TFunction): string {
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU'
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  const hm = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 0) return t('runnerView.time.today', { time: hm })
  if (diffDays === 1) return t('runnerView.time.yesterday', { time: hm })
  const datePart = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace(/\.$/, '')
  const suffix = i18n.language === 'en' ? ', ' : '., '
  return datePart + suffix + hm
}

// ── Session history ───────────────────────────────────────────────────────

function SessionHistoryList({
  apiSessions, localSessions, onOpenApi, onOpenLocal, maxItems,
}: {
  apiSessions: SessionListItem[]
  localSessions: RunnerSession[]
  onOpenApi: (item: SessionListItem) => void
  onOpenLocal: (id: string) => void
  maxItems?: number
}) {
  const { t } = useTranslation()
  const runningLocals = localSessions.filter(s => s.status === 'running')
  // Filter out api sessions that duplicate a local session
  const localRunIds = new Set(runningLocals.map(s => s.id))
  const dedupedApi = apiSessions.filter(s => !localRunIds.has(s.run_id))
  const hasAny = runningLocals.length > 0 || dedupedApi.length > 0
  if (!hasAny) return null

  // Merge + sort: running first, then by recency
  const allSorted = [
    ...runningLocals.map(s => ({ _type: 'local' as const, startedAt: s.startedAt, local: s, api: null as null })),
    ...dedupedApi.map(s => ({ _type: 'api' as const, startedAt: new Date(s.created_at).getTime(), local: null as null, api: s })),
  ].sort((a, b) => b.startedAt - a.startedAt)

  const visible = maxItems ? allSorted.slice(0, maxItems) : allSorted

  return (
    <div className="sessions-history">
      <div className="hist-list">
        {visible.map((item, i) =>
          item._type === 'local' ? (
            <div key={item.local!.id} className="hist-item" onClick={() => onOpenLocal(item.local!.id)}>
              <StatusBadge status={item.local!.status} />
              <span className="hist-title" title={item.local!.title}>{item.local!.title}</span>
              <span className="hist-config">{historyConfigLabel(item.local!.browserProfile, item.local!.result?.replayed, t) ?? '—'}</span>
              <span className="hist-meta">{fmtElapsed(Math.round((Date.now() - item.local!.startedAt) / 1000), t)}</span>
              <ChevronRight size={14} strokeWidth={1.75} className="hist-chevron" />
            </div>
          ) : (
            <div key={item.api!.run_id} className="hist-item" onClick={() => onOpenApi(item.api!)}>
              <StatusBadge status={item.api!.status} />
              <span
                className="hist-title"
                title={item.api!.test_case_id
                  ? t('runnerView.history.testCaseHash', { id: item.api!.test_case_id })
                  : t('runnerView.history.manualRun')}
              >
                {item.api!.test_case_id
                  ? t('runnerView.history.testCaseHash', { id: item.api!.test_case_id })
                  : t('runnerView.history.manualRun')}
              </span>
              <span className="hist-config">{historyConfigLabel(item.api!.browser_profile, item.api!.replayed, t) ?? '—'}</span>
              <span className="hist-meta">
                {t('runnerView.time.elapsedSec', { s: Math.round(item.api!.duration_sec) })} · {fmtDate(item.api!.created_at, t)}
              </span>
              <ChevronRight size={14} strokeWidth={1.75} className="hist-chevron" />
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Flow line ─────────────────────────────────────────────────────────────

function FlowLine({ steps }: { steps: string[] }) {
  return (
    <div className="flow-line">
      {steps.map((label, i) => (
        <div key={i} className="flow-step">
          <span className="flow-step-num">{i + 1}</span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Input Screen ──────────────────────────────────────────────────────────

interface InputScreenProps {
  mode: InputMode
  onModeChange: (m: InputMode) => void
  testItId: string
  onTestItIdChange: (v: string) => void
  fetchLoading: boolean
  fetchResult: FetchResult | null
  fetchError: string | null
  onFetch: () => void
  onRunManual: (task: string) => Promise<void>
  apiSessions: SessionListItem[]
  localSessions: RunnerSession[]
  onOpenApiSession: (item: SessionListItem) => void
  onOpenLocalSession: (id: string) => void
}

function InputScreen({
  mode, onModeChange,
  testItId, onTestItIdChange, fetchLoading, fetchResult, fetchError, onFetch,
  onRunManual, apiSessions, localSessions, onOpenApiSession, onOpenLocalSession,
}: InputScreenProps) {
  const { t } = useTranslation()
  const [manualTask, setManualTask] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [startingManual, setStartingManual] = useState(false)
  const [manualStartError, setManualStartError] = useState<string | null>(null)

  const canFetch = testItId.trim().length > 0 && !fetchLoading
  const canRun = manualTask.trim().length > 0 && !startingManual
  // Dedup: local sessions already in apiSessions (by run_id)
  const apiRunIds = new Set(apiSessions.map(s => s.run_id))
  const uniqueLocalCount = localSessions.filter(s => !apiRunIds.has(s.id)).length
  const sessionCount = uniqueLocalCount + apiSessions.length

  return (
    <div className="workspace-inner">
      <div className="workspace-col">

        {/* Section header */}
        <SectionHeader
          title={t('sidebar.testRunner')}
          subtitle={t('runnerView.subtitle')}
        />

        {/* Segmented control */}
        <div className="segmented-control">
          <button
            type="button"
            className={`segmented-option${mode === 'testit' ? ' segmented-option--active' : ''}`}
            onClick={() => onModeChange('testit')}
          >
            {t('runnerView.mode.fromTms')}
          </button>
          <button
            type="button"
            className={`segmented-option${mode === 'manual' ? ' segmented-option--active' : ''}`}
            onClick={() => onModeChange('manual')}
          >
            {t('runnerView.mode.manual')}
          </button>
        </div>

        <div className="source-panel">
          <div className="source-body">
            {/* ── TestIT mode ── */}
            {mode === 'testit' && (
              <>
                {/* TMS grid — TestIT only */}
                <div className="tms-grid">
                  <div className="tms-card tms-card-active">
                    <div className="tms-icon">
                      <img src="/icons/testit.png" width={20} height={20} alt="TestIT" style={{ objectFit: 'contain' }} />
                    </div>
                    <div className="tms-copy"><div className="tms-name">TestIT</div></div>
                  </div>
                </div>

                {/* ID input */}
                <div>
                  <label className="source-label" htmlFor="runner-testit-id">{t('runnerView.testCaseIdLabel')}</label>
                  <div className="source-input-row">
                    <input
                      id="runner-testit-id"
                      className="source-id-input"
                      type="text"
                      placeholder={t('runnerView.idPlaceholder')}
                      value={testItId}
                      onChange={e => onTestItIdChange(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && canFetch && onFetch()}
                      spellCheck={false}
                      disabled={fetchLoading}
                    />
                    <button
                      type="button"
                      className={`source-fetch-btn${!canFetch ? ' source-fetch-btn-muted' : ''}`}
                      onClick={onFetch}
                      disabled={!canFetch}
                    >
                      {fetchLoading
                        ? <><Loader2 size={15} className="spin-icon" />{t('runnerView.loading')}</>
                        : <><Upload size={15} />{t('runnerView.load')}</>}
                    </button>
                  </div>
                </div>

                {fetchError && (
                  <div className="alert alert-error">
                    <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
                    <span className="alert-text"><strong>{t('runnerView.errorPrefix')}</strong>{fetchError}</span>
                  </div>
                )}

                {/* Flow line */}
                <FlowLine steps={[
                  t('runnerView.flow.step1'),
                  t('runnerView.flow.step2'),
                  t('runnerView.flow.step3'),
                ]} />
              </>
            )}

            {/* ── Manual mode ── */}
            {mode === 'manual' && (
              <>
                {/* Task textarea with char counter */}
                <div>
                  <label className="source-label" htmlFor="runner-manual-task">{t('runnerView.manualTask.label')}</label>
                  <div className="runner-task-wrap">
                    <textarea
                      id="runner-manual-task"
                      className="runner-task-textarea runner-task-compact"
                      placeholder={t('runnerView.manualTask.placeholder')}
                      value={manualTask}
                      onChange={e => setManualTask(e.target.value)}
                      maxLength={4000}
                    />
                    <span className="runner-task-counter">{manualTask.length} / 4000</span>
                  </div>
                </div>



                {/* CTA button — full width */}
                <button
                  type="button"
                  className="runner-cta-btn"
                  onClick={async () => {
                    setStartingManual(true)
                    setManualStartError(null)
                    try {
                      await onRunManual(manualTask)
                    } catch (err) {
                      setManualStartError(humanizeFetchError((err as Error).message))
                      setStartingManual(false)
                    }
                  }}
                  disabled={!canRun}
                >
                  {startingManual
                    ? <><Loader2 size={16} className="spin-icon" />{t('runnerView.loading')}</>
                    : <><Play size={16} />{t('runnerView.run')}</>}
                </button>

                {manualStartError && (
                  <div className="alert alert-error">
                    <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
                    <span className="alert-text"><strong>{t('runnerView.errorPrefix')}</strong>{manualStartError}</span>
                  </div>
                )}

                {/* Limitations — callout */}
                <div className="limits-callout">
                  <AlertTriangle size={14} strokeWidth={1.5} />
                  <div className="limits-callout-text">
                    <span className="limits-callout-title">{t('runnerView.manualTask.limitsTitle')}</span>
                    <span>{t('runnerView.manualTask.limitsCaptcha')}</span>
                    <span>{t('runnerView.manualTask.limitsDialogs')}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Session history — accordion */}
        {sessionCount > 0 && (
          <div className="history-accordion">
            <button
              type="button"
              className={`history-accordion-btn${historyOpen ? ' history-accordion-btn--open' : ''}`}
              onClick={() => { setHistoryOpen(v => !v); setShowAllHistory(false) }}
            >
              <span>{t('runnerView.history.recentRuns', { count: sessionCount })}</span>
              <ChevronDown
                size={14}
                strokeWidth={1.75}
                className={`history-toggle-chevron${historyOpen ? ' open' : ''}`}
              />
            </button>
            {historyOpen && (
              <div className="history-accordion-body">
                <SessionHistoryList
                  apiSessions={apiSessions}
                  localSessions={localSessions}
                  onOpenApi={onOpenApiSession}
                  onOpenLocal={onOpenLocalSession}
                  maxItems={showAllHistory ? undefined : 5}
                />
                {sessionCount > 5 && (
                  <button
                    type="button"
                    className="history-show-more"
                    onClick={() => setShowAllHistory(v => !v)}
                  >
                    {showAllHistory ? t('runnerView.history.hide') : t('runnerView.history.showAll', { count: sessionCount })}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── RunnerView ────────────────────────────────────────────────────────────

export function RunnerView() {
  const { t } = useTranslation()
  const [inputMode, setInputMode] = useState<InputMode>('testit')
  const [testItId, setTestItId] = useState('')
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [sessions, setSessions] = useState<RunnerSession[]>([])
  const [apiSessions, setApiSessions] = useState<SessionListItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isSmallScreen, setIsSmallScreen] = useState(false)

  useEffect(() => {
    function check() { setIsSmallScreen(window.innerWidth < 1024) }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    api.listSessions()
      .then(data => setApiSessions(data.sessions))
      .catch(() => {})
  }, [])

  async function handleFetch() {
    const id = testItId.trim()
    if (!id) return
    setFetchLoading(true)
    setFetchError(null)
    setFetchResult(null)
    try {
      setFetchResult(await api.fetchWorkItem(id))
    } catch (err) {
      setFetchError(humanizeFetchError((err as Error).message))
    } finally {
      setFetchLoading(false)
    }
  }

  function handleTestItIdChange(v: string) {
    setTestItId(v)
    if (fetchResult || fetchError) { setFetchResult(null); setFetchError(null) }
  }

  function handleModeChange(m: InputMode) {
    setInputMode(m)
    setFetchResult(null)
    setFetchError(null)
  }

  function startSession(session: RunnerSession) {
    setSessions(prev => [session, ...prev])
    setActiveSessionId(session.id)
  }

  function manualTitle(task: string, startUrl?: string): string {
    const prefix = t('runnerView.history.manualRun')
    const httpsUrl = task.match(/https?:\/\/[^\s)>\]"']+/)?.[0]
    const bareDomain = !httpsUrl ? task.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?)\b/i)?.[0] : undefined
    const url = startUrl || httpsUrl || bareDomain
    if (url) {
      try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`)
        const path = u.pathname !== '/' ? u.pathname.slice(0, 20) : ''
        return `${prefix} · ${u.hostname}${path}`
      } catch {}
    }
    const clean = task.replace(/\n/g, ' ').replace(/^\s*\d+[.):\s]\s*/g, '').trim()
    const words = clean.split(/\s+/).slice(0, 5).join(' ')
    return `${prefix} · ${words.length > 45 ? words.slice(0, 45) + '…' : words}`
  }

  // Posts /start-* here (button click), not inside RunnerSessionView's effect —
  // that effect used to generate its own run_id and fire this same request,
  // which meant React 18 StrictMode's dev-only double-invoke minted TWO
  // distinct run_ids and started the agent TWICE per click. The run_id is
  // generated once, right here, and reused as the session's own id, so
  // RunnerSessionView only ever connects to an already-started run.
  async function postStart(path: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let detail = t('runnerSession.wsErrors.httpError', { status: res.status })
      try { const err = await res.json(); detail = err.detail || detail } catch { /* use status */ }
      throw new Error(detail)
    }
  }

  async function handleRunManual(task: string) {
    const runId = crypto.randomUUID().replace(/-/g, '')
    const language = i18n.language === 'en' ? 'en' : 'ru'
    await postStart('/api/runner/start-manual', { task, language, run_id: runId })
    startSession(mkSession({ id: runId, title: manualTitle(task), source: 'manual', task }))
  }

  async function handleRunTestIt(iterationIndex = 0, forceRegenerate = false, browserProfile: BrowserProfileSettings = {}) {
    if (!fetchResult) return
    const tc = fetchResult.normalized_testcase
    const title = tc.title
      ? `${tc.title} #${fetchResult.work_item_id}`
      : t('runnerView.history.testCaseHash', { id: fetchResult.work_item_id })
    const runId = crypto.randomUUID().replace(/-/g, '')
    const language = i18n.language === 'en' ? 'en' : 'ru'
    await postStart('/api/runner/start-testit', {
      work_item_id: fetchResult.work_item_id,
      iteration_index: iterationIndex,
      language,
      run_id: runId,
      ...(forceRegenerate ? { force_regenerate: true } : {}),
      ...(Object.keys(browserProfile).length ? { browser_profile: browserProfile } : {}),
    })
    const cacheAttempt = (tc.tags ?? []).includes('cache-ok') && !forceRegenerate
    startSession(mkSession({
      id: runId, title, source: 'testit', workItemId: fetchResult.work_item_id, iterationIndex, forceRegenerate,
      cacheAttempt,
      ...(Object.keys(browserProfile).length ? { browserProfile } : {}),
    }))
  }

  function updateSession(id: string, update: Partial<RunnerSession>) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...update } : s))
    if (update.status && update.status !== 'running') {
      setTimeout(() => {
        api.listSessions()
          .then(data => setApiSessions(data.sessions))
          .catch(() => {})
      }, 1500)
    }
  }

  function openApiSession(item: SessionListItem) {
    const result: RunnerRunResponse = {
      status: item.status,
      summary: item.summary ?? '',
      steps_count: item.steps_count,
      instability_step_count: item.instability_step_count,
      retry_step_count: item.retry_step_count,
      errors: item.errors ?? [],
      screenshots: [],
      duration_sec: item.duration_sec,
      run_id: item.run_id,
      replayed: item.replayed,
    }
    const session: RunnerSession = {
      id: item.run_id,
      title: item.test_case_id
        ? t('runnerView.history.testCaseHash', { id: item.test_case_id })
        : t('runnerView.history.manualRun'),
      source: item.test_case_id ? 'testit' : 'manual',
      workItemId: item.test_case_id ?? undefined,
      status: item.status,
      result,
      startedAt: new Date(item.created_at).getTime(),
      endedAt: new Date(item.created_at).getTime() + item.duration_sec * 1000,
    }
    setSessions(prev => prev.find(s => s.id === session.id) ? prev : [session, ...prev])
    setActiveSessionId(session.id)
  }

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null

  // ── Resolution blocker ──
  if (isSmallScreen) {
    return (
      <main className="workspace">
        <div className="resolution-blocker">
          <Monitor size={48} strokeWidth={1.25} style={{ color: 'var(--tx-dim)' }} />
          <h2 className="resolution-blocker-title">{t('runnerView.resolutionBlocker.title')}</h2>
          <p className="resolution-blocker-desc">{t('runnerView.resolutionBlocker.desc')}</p>
        </div>
      </main>
    )
  }

  // Route: session page
  if (activeSession) {
    return (
      <main className="workspace workspace-wb">
        <RunnerSessionView
          key={activeSession.id}
          session={activeSession}
          onBack={() => setActiveSessionId(null)}
          onUpdate={update => updateSession(activeSession.id, update)}
        />
      </main>
    )
  }

  // Route: TestIT workbench
  if (fetchResult) {
    return (
      <main className="workspace workspace-wb">
        <TestItWorkbench
          fetchResult={fetchResult}
          onBack={() => { setFetchResult(null); setFetchError(null) }}
          onRun={handleRunTestIt}
        />
      </main>
    )
  }

  // Route: input screen
  return (
    <main className="workspace">
      <InputScreen
        mode={inputMode}
        onModeChange={handleModeChange}
        testItId={testItId}
        onTestItIdChange={handleTestItIdChange}
        fetchLoading={fetchLoading}
        fetchResult={fetchResult}
        fetchError={fetchError}
        onFetch={handleFetch}
        onRunManual={handleRunManual}
        apiSessions={apiSessions}
        localSessions={sessions}
        onOpenApiSession={openApiSession}
        onOpenLocalSession={setActiveSessionId}
      />
    </main>
  )
}
