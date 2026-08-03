import type { AnalyzeResult, ApplyResult, DraftResult, FetchResult, HistoricalStep, ImproveResult, ReviewConfig, ReviewIssue, ReviewRuleId, RunnerRunResponse, SessionListItem } from './types'
import i18n from './i18n'

const BASE = '/api'

function currentLanguage(): 'ru' | 'en' {
  return i18n.language === 'en' ? 'en' : 'ru'
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getReviewConfig: () => get<ReviewConfig>(`/review-config?language=${currentLanguage()}`),

  fetchWorkItem: (input: string) =>
    post<FetchResult>('/testit/workitem/fetch', { input, language: currentLanguage() }),

  improveTestCase: (body: {
    work_item?: unknown
    raw_content?: string
    selected_issues: ReviewIssue[]
    enabled_rules?: ReviewRuleId[]
  }) => post<ImproveResult>('/improve-testcase', { ...body, language: currentLanguage() }),

  analyzeTestCase: (body: {
    work_item?: unknown
    raw_content?: string
    enabled_rules?: ReviewRuleId[]
  }) =>
    post<AnalyzeResult>('/analyze-testcase', { ...body, language: currentLanguage() }),

  createDraft: (body: {
    improved_testcase: unknown
    source_work_item_id: string
    source_attributes: Record<string, unknown>
    manual_notes?: string[]
  }) => post<DraftResult>('/testit/workitem/create-draft', { ...body, language: currentLanguage() }),

  applyToOriginal: (body: {
    improved_testcase: unknown
    source_work_item_id: string
    source_attributes: Record<string, unknown>
  }) => post<ApplyResult>('/testit/workitem/update-original', { ...body, language: currentLanguage() }),

  runTestCase: (work_item_id: string) =>
    post<RunnerRunResponse>('/runner/run', { work_item_id }),

  runManual: (body: { task: string; start_url?: string; test_case_id?: string }) =>
    post<RunnerRunResponse>('/runner/run-manual', body),

  startManualStreaming: (body: { task: string; start_url?: string }) =>
    post<{ run_id: string }>('/runner/start-manual', body),

  startTestItStreaming: (work_item_id: string) =>
    post<{ run_id: string }>('/runner/start-testit', { work_item_id }),

  listSessions: () =>
    get<{ sessions: SessionListItem[] }>('/runner/sessions'),

  getSessionSteps: (runId: string) =>
    get<{ steps: HistoricalStep[] }>(`/runner/sessions/${runId}/steps`),

}

// Backend errors from Task 5 onward are already localized in the current UI
// language — these functions now only strip the "HTTP xxx: " prefix so the
// user doesn't see raw HTTP jargon, and add HTTP-status-code-based framing
// where useful (status codes are language-independent, unlike the phrase-
// matching this used to do against the backend's — now localized — text).
function stripHttpPrefix(msg: string): string {
  const match = msg.match(/^HTTP \d+: (.*)$/s)
  return match ? match[1] : msg
}

export function humanizeFetchError(msg: string): string {
  return stripHttpPrefix(msg)
}

export function humanizeDraftError(msg: string): string {
  return stripHttpPrefix(msg)
}
