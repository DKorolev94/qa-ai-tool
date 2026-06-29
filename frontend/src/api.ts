import type { AnalyzeResult, ApplyResult, DraftResult, FetchResult, HistoricalStep, ImproveResult, ReviewConfig, ReviewIssue, ReviewRuleId, RunnerRunResponse, SessionListItem } from './types'

const BASE = '/api'

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
  getReviewConfig: () => get<ReviewConfig>('/review-config'),

  fetchWorkItem: (input: string) =>
    post<FetchResult>('/testit/workitem/fetch', { input }),

  improveTestCase: (body: {
    work_item?: unknown
    raw_content?: string
    selected_issues: ReviewIssue[]
    source_type?: 'testit' | 'manual'
    enabled_rules?: ReviewRuleId[]
  }) => post<ImproveResult>('/improve-testcase', body),

  analyzeTestCase: (body: {
    work_item?: unknown
    raw_content?: string
    source_type?: 'testit' | 'manual'
    enabled_rules?: ReviewRuleId[]
  }) =>
    post<AnalyzeResult>('/analyze-testcase', body),

  createDraft: (body: {
    improved_testcase: unknown
    source_work_item_id: string
    source_attributes: Record<string, unknown>
    manual_notes?: string[]
  }) => post<DraftResult>('/testit/workitem/create-draft', body),

  applyToOriginal: (body: {
    improved_testcase: unknown
    source_work_item_id: string
    source_attributes: Record<string, unknown>
  }) => post<ApplyResult>('/testit/workitem/update-original', body),

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

export function parseManualInput(raw: string): { work_item?: unknown; raw_content?: string } {
  try {
    return { work_item: JSON.parse(raw) }
  } catch {
    return { raw_content: raw }
  }
}

export function humanizeFetchError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('401') || m.includes('403'))
    return 'TestIT: authorization error. Check TESTIT_PRIVATE_TOKEN in .env'
  if (m.includes('404') || m.includes('not found'))
    return 'Test case not found. Check the ID'
  if (m.includes('503') || m.includes('unavailable') || m.includes('configured'))
    return 'TestIT unavailable or TESTIT_BASE_URL/TOKEN not configured in .env'
  if (m.includes('could not extract'))
    return 'Invalid input. Use a numeric ID, e.g.: 6109'
  return msg
}

export function humanizeDraftError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('testit_project'))
    return 'TESTIT_PROJECT_UUID not set in backend .env'
  if (m.includes('testit_draft_section'))
    return 'TESTIT_DRAFT_SECTION_UUID not set in backend .env'
  if (m.includes('401') || m.includes('403'))
    return 'TestIT: authorization error'
  if (m.includes('503') || m.includes('configured'))
    return 'TestIT unavailable or not configured'
  return msg
}
