import { useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Clock3, FileInput,
  FileText, HardDrive, List, Loader2, Lock, Play,
  Shield, Upload, XCircle,
} from 'lucide-react'
import { api, humanizeFetchError } from '../api'
import { RunnerSessionView, StatusBadge } from './RunnerSessionView'
import { SectionHeader } from './SectionHeader'
import type { FetchResult, RunnerRunResponse, RunnerSession, SessionListItem, Step } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────

type InputMode = 'testit' | 'manual'

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}м ${String(s % 60).padStart(2, '0')}с` : `${s}с`
}

function mkSession(
  base: Pick<RunnerSession, 'title' | 'source'> &
    Partial<Pick<RunnerSession, 'task' | 'startUrl' | 'workItemId' | 'iterationIndex'>>
): RunnerSession {
  return {
    id: crypto.randomUUID(),
    status: 'running',
    startedAt: Date.now(),
    ...base,
  }
}

// ── Compact steps table ───────────────────────────────────────────────────

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
          <div className="steps-th">Действие</div>
          <div className="steps-th">Ожидаемый результат</div>
          {hasTestData && <div className="steps-th">Тестовые данные</div>}
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
      <label className="source-label">Набор параметров (стенд / итерация)</label>
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
            <Play size={13} /> Запустить
          </button>
        </div>
      </div>

      <div className="wb-grid" style={{ flex: 1, minHeight: 0 }}>
        <div className="wb-main">
          <div className="wb-tabs-row">
            <div className="wb-tab wb-tab-active" style={{ cursor: 'default' }}>Тест-кейс</div>
          </div>
          <div className="wb-content">
            <StepBlock label="Предусловие" steps={tc.preconditions} />
            <div>
              <span className="case-sec-label">Шаги</span>
              {tc.steps?.length ? (() => {
                const hasTestData = tc.steps.some(s => s.test_data)
                const cols = hasTestData ? '28px 1fr 1fr 1fr' : '28px 1fr 1fr'
                return (
                  <div className="steps-tbl">
                    <div className="steps-head" style={{ gridTemplateColumns: cols }}>
                      <div className="steps-th steps-th-num">#</div>
                      <div className="steps-th">Действие</div>
                      <div className="steps-th">Ожидаемый результат</div>
                      {hasTestData && <div className="steps-th">Тестовые данные</div>}
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
                <div className="case-text-box case-text-empty">не указано</div>
              )}
            </div>
            <StepBlock label="Постусловие" steps={tc.postconditions} />
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

        {/* Right placeholder — no run rail, session will open on Run */}
        <div className="wb-run-hint">
          <Play size={28} strokeWidth={1.4} style={{ color: 'var(--tx-dim)' }} />
          <span>Нажмите «Запустить» — откроется страница сессии</span>
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
  if (diffDays === 0) return `сегодня ${hm}`
  if (diffDays === 1) return `вчера ${hm}`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + hm
}

// ── Session history list ──────────────────────────────────────────────────

function SessionHistoryList({
  apiSessions, localSessions, onOpenApi, onOpenLocal,
}: {
  apiSessions: SessionListItem[]
  localSessions: RunnerSession[]
  onOpenApi: (item: SessionListItem) => void
  onOpenLocal: (id: string) => void
}) {
  const runningLocals = localSessions.filter(s => s.status === 'running')
  const hasAny = runningLocals.length > 0 || apiSessions.length > 0
  if (!hasAny) return null

  return (
    <div className="sessions-history">
      <div className="sessions-hist-title">Последние прогоны</div>
      <div className="hist-list">
        {runningLocals.map(s => (
          <div key={s.id} className="hist-item" onClick={() => onOpenLocal(s.id)}>
            <StatusBadge status={s.status} />
            <span className="hist-title" title={s.title}>{s.title}</span>
            <span className="hist-meta">{fmtElapsed(Math.round((Date.now() - s.startedAt) / 1000))}</span>
          </div>
        ))}
        {apiSessions.slice(0, 10).map(s => (
          <div key={s.run_id} className="hist-item" onClick={() => onOpenApi(s)}>
            <StatusBadge status={s.status} />
            <span className="hist-title" title={s.test_case_id ? `Тест-кейс #${s.test_case_id}` : 'Ручной запуск'}>
              {s.test_case_id ? `Тест-кейс #${s.test_case_id}` : 'Ручной запуск'}
            </span>
            <span className="hist-meta">{Math.round(s.duration_sec)}с · {fmtDate(s.created_at)}</span>
          </div>
        ))}
      </div>
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
  onRunManual: (task: string, startUrl?: string) => void
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
  const [manualUrl, setManualUrl] = useState('')

  const canFetch = testItId.trim().length > 0 && !fetchLoading
  const canRun = manualTask.trim().length > 0

  const heroTitle = mode === 'manual' ? 'Опишите задачу для запуска' : 'Загрузите тест-кейс для запуска'
  const heroDesc = mode === 'manual'
    ? 'Агент выполнит описанные шаги в браузере автоматически.'
    : 'Импортируйте тест-кейс из TestIT по ID — агент выполнит шаги в браузере автоматически.'

  return (
    <div className="workspace-inner">
      <div className="workspace-col">
        <SectionHeader title="Test Runner" />
        <div className="source-panel">

          {/* Hero */}
          <div className="source-hero">
            <div className="source-hero-icon">
              <FileInput size={20} strokeWidth={1.75} />
            </div>
            <div className="source-hero-copy">
              <h2 className="source-hero-title">{heroTitle}</h2>
              <p className="source-hero-desc">{heroDesc}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="source-tabs">
            <button
              type="button"
              className={`source-tab${mode === 'testit' ? ' source-tab-active' : ''}`}
              onClick={() => onModeChange('testit')}
            >
              Из TMS
            </button>
            <button
              type="button"
              className={`source-tab${mode === 'manual' ? ' source-tab-active' : ''}`}
              onClick={() => onModeChange('manual')}
            >
              Вручную
            </button>
          </div>

          {mode === 'testit' && (
            <div className="source-body">
              {/* TMS grid */}
              <div className="tms-grid">
                <div className="tms-card tms-card-active">
                  <div className="tms-icon">
                    <img src="/icons/testit.png" width={20} height={20} alt="TestIT" style={{ objectFit: 'contain' }} />
                  </div>
                  <div className="tms-copy"><div className="tms-name">TestIT</div></div>
                  <span className="tms-state tms-state-ok">Доступно</span>
                </div>
                {(['TestRail', 'Allure TestOps', 'Zephyr'] as const).map((name, i) => (
                  <div key={name} className="tms-card tms-card-disabled">
                    <div className="tms-icon">
                      <img
                        src={['/icons/testrail.png', '/icons/allure.png', '/icons/zephyr.png'][i]}
                        width={20} height={20} alt={name}
                        style={{ objectFit: 'contain', borderRadius: 4 }}
                      />
                    </div>
                    <div className="tms-copy"><div className="tms-name">{name}</div></div>
                    <span className="tms-state tms-state-soon">Скоро</span>
                  </div>
                ))}
              </div>

              {/* ID input */}
              <div>
                <label className="source-label" htmlFor="runner-testit-id">ID тест-кейса в TestIT</label>
                <div className="source-input-row">
                  <input
                    id="runner-testit-id"
                    className="source-id-input"
                    type="text"
                    placeholder="Например: 6110"
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
                      ? <><Loader2 size={15} className="spin-icon" />Загружаю...</>
                      : <><Upload size={15} />Загрузить из TestIT</>}
                  </button>
                </div>
              </div>

              {fetchError && (
                <div className="alert alert-error">
                  <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
                  <span className="alert-text"><strong>Ошибка: </strong>{fetchError}</span>
                </div>
              )}

              {fetchResult && (
                <div className="alert alert-success">
                  <span className="alert-icon-ok"><CheckCircle2 size={16} strokeWidth={1.75} /></span>
                  <span className="alert-text"><strong>Загружено: </strong>{fetchResult.normalized_testcase.title}</span>
                  <span className="alert-id">{fetchResult.work_item_id}</span>
                </div>
              )}

              {/* Status bar */}
              <div className="status-bar">
                <div className="status-chip">
                  <span className="status-chip-icon"><HardDrive size={14} strokeWidth={1.75} /></span>
                  <span className="status-chip-label">Источник</span>
                  <span className="status-chip-value">TestIT</span>
                </div>
                <div className="status-chip">
                  <span className="status-chip-icon"><Clock3 size={14} strokeWidth={1.75} /></span>
                  <span className="status-chip-label">Движок</span>
                  <span className="status-chip-value">browser-use</span>
                </div>
                <div className="status-chip">
                  <span className="status-chip-icon"><Play size={14} strokeWidth={1.75} /></span>
                  <span className="status-chip-label">Режим</span>
                  <span className="status-chip-value">Авто (без пауз)</span>
                </div>
              </div>

              {/* Info cards */}
              <div className="info-grid">
                <div className="info-card">
                  <div className="info-card-title">
                    <span className="info-card-title-icon"><List size={14} strokeWidth={1.75} /></span>
                    Как это работает
                  </div>
                  <div className="info-steps">
                    <div className="info-step"><span className="info-step-num">1</span>Загрузите тест-кейс из TestIT</div>
                    <div className="info-step"><span className="info-step-num">2</span>Просмотрите шаги теста</div>
                    <div className="info-step"><span className="info-step-num">3</span>Нажмите «Запустить» — откроется страница сессии</div>
                  </div>
                </div>
                <div className="info-card">
                  <div className="info-card-title">
                    <span className="info-card-title-icon"><FileText size={14} strokeWidth={1.75} /></span>
                    Что используется
                  </div>
                  <div className="info-card-body">
                    Предусловия, шаги и ожидаемые результаты из TestIT передаются агенту как задача.
                  </div>
                  <div className="info-tag">
                    <Lock size={10} strokeWidth={2} />
                    Только чтение
                  </div>
                </div>
                <div className="info-card">
                  <div className="info-card-title">
                    <span className="info-card-title-icon"><Shield size={14} strokeWidth={1.75} /></span>
                    Результат прогона
                  </div>
                  <div className="info-card-body">
                    Агент возвращает статус (passed / failed / blocked), описание и скриншоты по шагам.
                  </div>
                </div>
              </div>
            </div>
          )}

          {mode === 'manual' && (
            <div className="source-body">
              <div>
                <label className="source-label" htmlFor="runner-manual-task">Задача для агента</label>
                <textarea
                  id="runner-manual-task"
                  className="runner-task-textarea"
                  placeholder={"Опишите шаги для агента, например:\n1. Открой страницу входа\n2. Авторизуйся как admin / password123\n3. Перейди в раздел «Пользователи»\n4. Проверь, что таблица отображается"}
                  value={manualTask}
                  onChange={e => setManualTask(e.target.value)}
                />
              </div>
              <div>
                <label className="source-label" htmlFor="runner-manual-url">Стартовый URL (необязательно)</label>
                <div className="source-input-row">
                  <input
                    id="runner-manual-url"
                    className="source-id-input"
                    type="text"
                    placeholder="https://example.com"
                    value={manualUrl}
                    onChange={e => setManualUrl(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className={`source-fetch-btn${!canRun ? ' source-fetch-btn-muted' : ''}`}
                    onClick={() => canRun && onRunManual(manualTask, manualUrl.trim() || undefined)}
                    disabled={!canRun}
                  >
                    <Play size={14} /> Запустить
                  </button>
                </div>
                <p className="source-field-hint">Если не указан, агент возьмёт адрес из текста задачи</p>
              </div>

              {/* Info cards */}
              <div className="info-grid">
                <div className="info-card">
                  <div className="info-card-title">
                    <span className="info-card-title-icon"><List size={14} strokeWidth={1.75} /></span>
                    Как запустить
                  </div>
                  <div className="info-steps">
                    <div className="info-step"><span className="info-step-num">1</span>Опишите действия на русском языке</div>
                    <div className="info-step"><span className="info-step-num">2</span>Укажите URL если агент должен начать с конкретной страницы</div>
                    <div className="info-step"><span className="info-step-num">3</span>Нажмите «Запустить»</div>
                  </div>
                </div>
                <div className="info-card">
                  <div className="info-card-title">
                    <span className="info-card-title-icon"><Shield size={14} strokeWidth={1.75} /></span>
                    Результат прогона
                  </div>
                  <div className="info-card-body">
                    Агент возвращает статус, описание и скриншоты выполненных шагов.
                  </div>
                </div>
                <div className="info-card">
                  <div className="info-card-title">
                    <span className="info-card-title-icon"><AlertTriangle size={14} strokeWidth={1.75} /></span>
                    Ограничения
                  </div>
                  <div className="info-card-body">
                    Агент не справится с: капчей, двухфакторной авторизацией, pop-up окнами браузера (загрузка файлов, диалоги ОС).
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Session history */}
        <SessionHistoryList
          apiSessions={apiSessions}
          localSessions={localSessions}
          onOpenApi={onOpenApiSession}
          onOpenLocal={onOpenLocalSession}
        />
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

  function startSession(session: RunnerSession) {
    setSessions(prev => [session, ...prev])
    setActiveSessionId(session.id)
  }

  function handleRunManual(task: string, startUrl?: string) {
    const title = task.length > 70 ? `${task.slice(0, 70)}…` : task
    startSession(mkSession({ title, source: 'manual', task, startUrl }))
  }

  function handleRunTestIt(iterationIndex = 0) {
    if (!fetchResult) return
    const tc = fetchResult.normalized_testcase
    const title = tc.title ? `${tc.title} #${fetchResult.work_item_id}` : `Тест-кейс #${fetchResult.work_item_id}`
    startSession(mkSession({ title, source: 'testit', workItemId: fetchResult.work_item_id, iterationIndex }))
  }

  function handleRerun(prev: RunnerSession) {
    startSession(mkSession({
      title: prev.title,
      source: prev.source,
      task: prev.task,
      startUrl: prev.startUrl,
      workItemId: prev.workItemId,
      iterationIndex: prev.iterationIndex,
    }))
  }

  function updateSession(id: string, update: Partial<RunnerSession>) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...update } : s))
    // Refresh API history when a session finishes
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
      summary: '',
      steps_count: item.steps_count,
      errors: [],
      screenshots: [],
      duration_sec: item.duration_sec,
      run_id: item.run_id,
    }
    const session: RunnerSession = {
      id: item.run_id,
      title: item.test_case_id ? `Тест-кейс #${item.test_case_id}` : 'Ручной запуск',
      source: item.test_case_id ? 'testit' : 'manual',
      workItemId: item.test_case_id ?? undefined,
      status: item.status,
      result,
      startedAt: new Date(item.created_at).getTime(),
      endedAt: new Date(item.created_at).getTime() + item.duration_sec * 1000,
    }
    // Add to sessions if not already there
    setSessions(prev => prev.find(s => s.id === session.id) ? prev : [session, ...prev])
    setActiveSessionId(session.id)
  }

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null

  // Route: session page
  if (activeSession) {
    return (
      <main className="workspace workspace-wb">
        <RunnerSessionView
          session={activeSession}
          onBack={() => setActiveSessionId(null)}
          onRerun={() => handleRerun(activeSession)}
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
        onModeChange={setInputMode}
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
