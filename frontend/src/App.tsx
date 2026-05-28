import { useCallback, useEffect, useRef, useState } from 'react'
import { api, humanizeDraftError, humanizeFetchError, parseManualInput } from './api'
import { ImprovedPanel } from './components/ImprovedPanel'
import { ProgressBar } from './components/ProgressBar'
import { ReviewPanel } from './components/ReviewPanel'
import { Sidebar } from './components/Sidebar'
import { SourcePanel } from './components/SourcePanel'
import { Toolbar } from './components/Toolbar'
import type {
  DraftResult,
  FetchResult,
  ImproveResult,
  OpStatus,
  ReviewResult,
  SourceMode,
  TestCase,
} from './types'

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sourceMode, setSourceMode] = useState<SourceMode>('testit')
  const sourceType = sourceMode
  const [testItId, setTestItId] = useState('')
  const [manualText, setManualText] = useState('')

  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchLoading, setFetchLoading] = useState(false)

  const [workItem, setWorkItem] = useState<unknown>(null)
  const [sourceWorkItemId, setSourceWorkItemId] = useState<string | null>(null)
  const [sourceAttributes, setSourceAttributes] = useState<Record<string, unknown>>({})

  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [issueChecked, setIssueChecked] = useState<boolean[]>([])

  const [improveResult, setImproveResult] = useState<ImproveResult | null>(null)
  const [improveError, setImproveError] = useState<string | null>(null)
  const [improveLoading, setImproveLoading] = useState(false)
  const [editableTC, setEditableTC] = useState<TestCase | null>(null)
  const [liveJson, setLiveJson] = useState('')

  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const [draftResult, setDraftResult] = useState<DraftResult | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)

  const [status, setStatus] = useState<OpStatus | null>(null)
  const improvedPanelRef = useRef<HTMLDivElement | null>(null)

  const anyLoading = fetchLoading || reviewLoading || improveLoading || analyzeLoading
  const showImproved = !!(improveResult || improveLoading || improveError)

  useEffect(() => {
    if (editableTC) setLiveJson(JSON.stringify(editableTC, null, 2))
  }, [editableTC])

  useEffect(() => {
    if (!improveResult) return
    requestAnimationFrame(() => {
      improvedPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [improveResult])

  const handleEditableChange = useCallback((tc: TestCase) => setEditableTC(tc), [])

  function getFilteredReview(): ReviewResult | null {
    if (!reviewResult) return null
    if (!issueChecked.length) return reviewResult
    const allChecked = issueChecked.every(Boolean)
    if (allChecked) return reviewResult
    return { ...reviewResult, issues: reviewResult.issues.filter((_, index) => issueChecked[index] ?? true) }
  }

  function getSourceBody() {
    if (sourceMode === 'testit' && workItem) return { work_item: workItem }
    return parseManualInput(manualText)
  }

  const canReview = () => sourceMode === 'testit' ? !!workItem : manualText.trim().length > 0
  const canImprove = canReview
  const canImproveNow = canImprove() && !!reviewResult

  async function handleFetch() {
    const value = testItId.trim()
    if (!value) return
    setFetchLoading(true); setFetchError(null); setFetchResult(null); setWorkItem(null)
    setStatus({ msg: 'Загружаю из TestIT…', type: 'loading' })
    try {
      const data = await api.fetchWorkItem(value)
      setFetchResult(data); setWorkItem(data.raw_work_item)
      setSourceWorkItemId(data.work_item_id)
      setSourceAttributes((data.raw_work_item as Record<string, unknown>)?.attributes as Record<string, unknown> ?? {})
      setStatus({ msg: `Тест-кейс ${data.work_item_id} загружен`, type: 'success' })
    } catch (err) {
      const msg = humanizeFetchError((err as Error).message)
      setFetchError(msg); setStatus({ msg, type: 'error' })
    } finally { setFetchLoading(false) }
  }

  async function handleReview() {
    const body = getSourceBody()
    setReviewLoading(true); setReviewError(null); setReviewResult(null); setIssueChecked([])
    setStatus({ msg: 'AI ревью…', type: 'loading' })
    try {
      const data = await api.reviewTestCase(body)
      setReviewResult(data)
      setIssueChecked(data.issues?.map(() => true) ?? [])
      setStatus({ msg: `Ревью завершено · замечаний: ${data.issues?.length ?? 0}`, type: 'success' })
    } catch (err) {
      const msg = (err as Error).message
      setReviewError(msg); setStatus({ msg: `Ошибка ревью: ${msg}`, type: 'error' })
    } finally { setReviewLoading(false) }
  }

  async function handleImprove() {
    const body = getSourceBody()
    const selectedIssues = reviewResult?.issues?.filter((_, index) => issueChecked[index] ?? true) ?? []
    setImproveLoading(true); setImproveError(null)
    setDraftResult(null); setDraftError(null)
    if (sourceMode === 'manual') { setSourceWorkItemId(null); setSourceAttributes({}) }
    setStatus({ msg: 'AI улучшение…', type: 'loading' })
    try {
      const data = await api.improveTestCase({ ...body, selected_issues: selectedIssues, source_type: sourceType })
      setImproveResult(data)
      setEditableTC({ ...data.improved_testcase, display_duration: data.display_duration })
      const resolutions = data.issue_resolutions ?? []
      const resolvedCount = resolutions.filter((resolution) => resolution.status === 'resolved').length
      const unresolvedCount = resolutions.filter((resolution) => resolution.status !== 'resolved').length
      const msg = resolutions.length
        ? unresolvedCount > 0
          ? `Кейс улучшен частично: ${resolvedCount} исправлено, ${unresolvedCount} требуют доработки`
          : `Кейс улучшен: исправлено ${resolvedCount}`
        : 'Улучшение завершено'
      setStatus({ msg, type: 'success' })
    } catch (err) {
      const msg = (err as Error).message
      setImproveError(msg); setStatus({ msg: `Ошибка: ${msg}`, type: 'error' })
    } finally { setImproveLoading(false) }
  }

  async function handleAnalyze() {
    const body = getSourceBody()
    setAnalyzeLoading(true); setAnalyzeError(null)
    setImproveResult(null); setImproveError(null)
    setDraftResult(null); setDraftError(null)
    if (sourceMode === 'manual') { setSourceWorkItemId(null); setSourceAttributes({}) }
    setStatus({ msg: 'AI анализ…', type: 'loading' })
    try {
      const data = await api.analyzeTestCase({ ...body, source_type: sourceType })
      setReviewResult({ summary: data.summary, issues: data.issues, suggested_test_cases: [], warnings: data.warnings })
      setIssueChecked(data.issues?.map(() => true) ?? [])
      setStatus({ msg: `Анализ завершён · замечаний: ${data.issues?.length ?? 0}`, type: 'success' })
    } catch (err) {
      const msg = (err as Error).message
      setAnalyzeError(msg); setStatus({ msg: `Ошибка: ${msg}`, type: 'error' })
    } finally { setAnalyzeLoading(false) }
  }

  async function handleCreateDraft() {
    if (!editableTC) return
    const testCase = JSON.parse(liveJson) as TestCase
    setDraftLoading(true); setDraftError(null); setDraftResult(null)
    try {
      const data = await api.createDraft({
        improved_testcase: testCase,
        source_work_item_id: sourceWorkItemId ?? 'unknown',
        source_attributes: sourceAttributes,
      })
      setDraftResult(data)
      setStatus({ msg: `Черновик создан: ${data.global_id ?? data.work_item_id}`, type: 'success' })
    } catch (err) {
      const msg = humanizeDraftError((err as Error).message)
      setDraftError(msg); setStatus({ msg, type: 'error' })
    } finally { setDraftLoading(false) }
  }

  async function handleCopy() {
    if (!liveJson) return
    try { await navigator.clipboard.writeText(liveJson) }
    catch { setStatus({ msg: 'Нет доступа к буферу обмена', type: 'error' }) }
  }

  function handleClear() {
    setTestItId(''); setManualText('')
    setFetchResult(null); setFetchError(null)
    setWorkItem(null); setSourceWorkItemId(null); setSourceAttributes({})
    setReviewResult(null); setReviewError(null); setIssueChecked([])
    setImproveResult(null); setImproveError(null)
    setAnalyzeError(null)
    setEditableTC(null); setLiveJson('')
    setDraftResult(null); setDraftError(null)
    setStatus(null)
  }

  function handleDownload() {
    if (!liveJson) return
    const url = URL.createObjectURL(new Blob([liveJson], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'improved_testcase.json'; link.click()
    URL.revokeObjectURL(url)
  }

  function handleIssueCheck(index: number, checked: boolean) {
    setIssueChecked(prev => { const next = [...prev]; next[index] = checked; return next })
  }

  return (
    <div className={`layout-root${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <ProgressBar active={anyLoading || draftLoading} />
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />
      <Toolbar status={status} onClear={handleClear} canClear={!!(fetchResult || reviewResult || improveResult || manualText || testItId)} />

      <main className="layout-workspace">
        <div className="pipeline-grid">
          <div className="pipeline-top">
            <SourcePanel
              mode={sourceMode} onModeChange={setSourceMode}
              testItId={testItId} onTestItIdChange={setTestItId}
              manualText={manualText} onManualTextChange={setManualText}
              fetchResult={fetchResult} fetchError={fetchError} fetchLoading={fetchLoading}
              onFetch={handleFetch}
              canReview={canReview()}
              onAnalyze={handleAnalyze}
              analyzeLoading={analyzeLoading}
              active={canReview()}
              canImprove={canImproveNow}
              onImprove={handleImprove}
              improveLoading={improveLoading}
            />
            <ReviewPanel
              result={reviewResult} loading={analyzeLoading} error={analyzeError}
              issueChecked={issueChecked} onIssueCheck={handleIssueCheck}
            />
          </div>

          <div className="panel-full" ref={improvedPanelRef}>
            <ImprovedPanel
              result={improveResult} loading={improveLoading} error={improveError}
              editableTC={editableTC} onEditableChange={handleEditableChange}
              draftResult={draftResult} draftError={draftError} draftLoading={draftLoading}
              onCopy={handleCopy} onDownload={handleDownload} onCreateDraft={handleCreateDraft}
              liveJson={liveJson}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
