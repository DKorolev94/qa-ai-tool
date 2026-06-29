import { useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Loader2, Monitor, Play, Plus, Upload, XCircle,
} from 'lucide-react'
import { api, humanizeFetchError } from '../api'
import { RunnerSessionView, StatusBadge } from './RunnerSessionView'
import { SectionHeader } from './SectionHeader'
import type { FetchResult, RunnerRunResponse, RunnerSession, SessionListItem, Step } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────

type InputMode = 'testit' | 'manual'

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

function mkSession(
  base: Pick<RunnerSession, 'title' | 'source'> &
    Partial<Pick<RunnerSession, 'task' | 'startUrl' | 'workItemId' | 'iterationIndex' | 'sensitiveData' | 'browserProfile'>>
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
  if (!steps?.length) return null
  const hasTestData = steps.some(s => s.test_data)
  const cols = hasTestData ? '28px 1fr 1fr 1fr' : '28px 1fr 1fr'
  return (
    <div>
      <span className="case-sec-label">{label}</span>
      <div className="steps-tbl">
        <div className="steps-head" style={{ gridTemplateColumns: cols }}>
          <div className="steps-th steps-th-num">#</div>
          <div className="steps-th">Action</div>
          <div className="steps-th">Expected result</div>
          {hasTestData && <div className="steps-th">Test data</div>}
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
  onRun: (iterationIndex: number) => void
}

function IterationPicker({
  names, rows, selected, onChange,
}: {
  names: string[]
  rows: string[][]
  selected: number
  onChange: (i: number) => void
}) {
  return (
    <div>
      <label className="source-label">Parameter set (environment / iteration)</label>
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
  const tc = fetchResult.normalized_testcase
  const pt = tc.parameter_table
  const hasIterations = pt && pt.rows.length > 1
  const [selectedIteration, setSelectedIteration] = useState(0)
  return (
    <div className="workspace-inner-wb">
      <SectionHeader title="Test Runner" onBack={onBack} />

      <div className="wb-card">
        <div className="wb-card-left">
          <div className="wb-title">{tc.title || '—'}</div>
          <div className="wb-meta-row">
            <span className="wb-source-badge">TestIT</span>
            <span className="wb-source-id">#{fetchResult.work_item_id}</span>
          </div>
        </div>
        <div className="wb-actions">
          <button type="button" className="source-fetch-btn" onClick={() => onRun(selectedIteration)}>
            <Play size={13} /> Run
          </button>
        </div>
      </div>

      <div className="wb-grid" style={{ flex: 1, minHeight: 0 }}>
        <div className="wb-main">
          <div className="wb-tabs-row">
            <div className="wb-tab wb-tab-active" style={{ cursor: 'default' }}>Test case</div>
          </div>
          <div className="wb-content">
            <StepBlock label="Precondition" steps={tc.preconditions} />
            <div>
              <span className="case-sec-label">Steps</span>
              {tc.steps?.length ? (() => {
                const hasTestData = tc.steps.some(s => s.test_data)
                const cols = hasTestData ? '28px 1fr 1fr 1fr' : '28px 1fr 1fr'
                return (
                  <div className="steps-tbl">
                    <div className="steps-head" style={{ gridTemplateColumns: cols }}>
                      <div className="steps-th steps-th-num">#</div>
                      <div className="steps-th">Action</div>
                      <div className="steps-th">Expected result</div>
                      {hasTestData && <div className="steps-th">Test data</div>}
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
                <div className="case-text-box case-text-empty">not specified</div>
              )}
            </div>
            <StepBlock label="Postcondition" steps={tc.postconditions} />
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
          <span>Click "Run" — the session page will open</span>
        </div>
      </div>
    </div>
  )
}

// ── Date formatting ───────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 0) return `Today, ${hm}`
  if (diffDays === 1) return `Yesterday, ${hm}`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') + '., ' + hm
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
              <span className="hist-meta">{fmtElapsed(Math.round((Date.now() - item.local!.startedAt) / 1000))}</span>
              <ChevronRight size={14} strokeWidth={1.75} className="hist-chevron" />
            </div>
          ) : (
            <div key={item.api!.run_id} className="hist-item" onClick={() => onOpenApi(item.api!)}>
              <StatusBadge status={item.api!.status} />
              <span className="hist-title" title={item.api!.test_case_id ? `Test case #${item.api!.test_case_id}` : 'Manual run'}>
                {item.api!.test_case_id ? `Test case #${item.api!.test_case_id}` : 'Manual run'}
              </span>
              <span className="hist-meta">{Math.round(item.api!.duration_sec)}s · {fmtDate(item.api!.created_at)}</span>
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
  onRunManual: (task: string) => void
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
  const [manualTask, setManualTask] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)

  const canFetch = testItId.trim().length > 0 && !fetchLoading
  const canRun = manualTask.trim().length > 0
  // Dedup: local sessions already in apiSessions (by run_id)
  const apiRunIds = new Set(apiSessions.map(s => s.run_id))
  const uniqueLocalCount = localSessions.filter(s => !apiRunIds.has(s.id)).length
  const sessionCount = uniqueLocalCount + apiSessions.length

  return (
    <div className="workspace-inner">
      <div className="workspace-col">

        {/* Section header */}
        <SectionHeader
          title="Test Runner"
          subtitle="AI agent automatically runs test cases in the browser"
        />

        {/* Segmented control */}
        <div className="segmented-control">
          <button
            type="button"
            className={`segmented-option${mode === 'testit' ? ' segmented-option--active' : ''}`}
            onClick={() => onModeChange('testit')}
          >
            From TMS
          </button>
          <button
            type="button"
            className={`segmented-option${mode === 'manual' ? ' segmented-option--active' : ''}`}
            onClick={() => onModeChange('manual')}
          >
            Manual
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
                  <label className="source-label" htmlFor="runner-testit-id">Test case ID in TestIT</label>
                  <div className="source-input-row">
                    <input
                      id="runner-testit-id"
                      className="source-id-input"
                      type="text"
                      placeholder="e.g. 6110"
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
                        ? <><Loader2 size={15} className="spin-icon" />Loading...</>
                        : <><Upload size={15} />Load</>}
                    </button>
                  </div>
                </div>

                {fetchError && (
                  <div className="alert alert-error">
                    <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
                    <span className="alert-text"><strong>Error: </strong>{fetchError}</span>
                  </div>
                )}

                {/* Flow line */}
                <FlowLine steps={['Load the test case', 'Review the steps', 'Click \'Run\'']} />
              </>
            )}

            {/* ── Manual mode ── */}
            {mode === 'manual' && (
              <>
                {/* Task textarea with char counter */}
                <div>
                  <label className="source-label" htmlFor="runner-manual-task">Task for agent</label>
                  <div className="runner-task-wrap">
                    <textarea
                      id="runner-manual-task"
                      className="runner-task-textarea runner-task-compact"
                      placeholder={"URL: https://app.example.com\n\n1. Sign in as admin (login: admin@example.com, password: secret123)\n2. Open the Users section\n3. Click \"Add user\"\n4. Fill in Name: Test User, Email: test@example.com\n5. Click \"Save\"\n6. Verify the user appears in the table with status Active"}
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
                  onClick={() => onRunManual(manualTask)}
                  disabled={!canRun}
                >
                  <Play size={16} /> Run
                </button>

                {/* Limitations — callout */}
                <div className="limits-callout">
                  <AlertTriangle size={14} strokeWidth={1.5} />
                  <div className="limits-callout-text">
                    <span className="limits-callout-title">Not yet supported</span>
                    <span>CAPTCHA / reCAPTCHA, two-factor authentication (2FA)</span>
                    <span>OS system dialogs, file upload, iframes, drag & drop</span>
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
              <span>Recent runs ({sessionCount})</span>
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
                    {showAllHistory ? 'Hide' : `Show all (${sessionCount})`}
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
    const prefix = 'Manual run'
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

  function handleRunManual(task: string) {
    startSession(mkSession({ title: manualTitle(task), source: 'manual', task }))
  }

  function handleRunTestIt(iterationIndex = 0) {
    if (!fetchResult) return
    const tc = fetchResult.normalized_testcase
    const title = tc.title ? `${tc.title} #${fetchResult.work_item_id}` : `Test case #${fetchResult.work_item_id}`
    startSession(mkSession({ title, source: 'testit', workItemId: fetchResult.work_item_id, iterationIndex }))
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
    }
    const session: RunnerSession = {
      id: item.run_id,
      title: item.test_case_id ? `Test case #${item.test_case_id}` : 'Manual run',
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
          <h2 className="resolution-blocker-title">Minimum resolution — 1024px</h2>
          <p className="resolution-blocker-desc">Expand the browser window or use an external monitor.</p>
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
