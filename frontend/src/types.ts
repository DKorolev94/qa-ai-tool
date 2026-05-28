export type SourceMode = 'testit' | 'manual'
export type Severity = 'high' | 'medium' | 'low'
export type ResolutionStatus = 'resolved' | 'manual_needed' | 'skipped'
export type StatusType = 'success' | 'error' | 'loading' | ''

export interface Step {
  action: string
  expected?: string | null
  test_data?: string | null
  comments?: string | null
}

export interface TestCase {
  title: string
  description?: string | null
  tags?: string[]
  priority?: string | null
  status?: string | null
  duration?: string | null
  display_duration?: string | null
  preconditions?: Step[]
  steps?: Step[]
  postconditions?: Step[]
  attributes?: Record<string, unknown>
}

export interface FetchResult {
  work_item_id: string
  normalized_testcase: TestCase
  raw_work_item: Record<string, unknown>
  warnings?: string[]
}

export interface ReviewIssue {
  severity: Severity
  title: string
  description: string
  recommendation: string
}

export interface SuggestedTestCase {
  type: string
  priority: string
  title: string
  steps: Step[]
}

export interface ReviewResult {
  summary: string
  issues: ReviewIssue[]
  suggested_test_cases: SuggestedTestCase[]
  warnings?: string[]
}

export interface IssueResolution {
  issue_title: string
  status: ResolutionStatus
  action_taken?: string
  reason?: string
}

export interface DiffChange {
  type: 'added' | 'changed' | 'removed'
  field: string
  before?: string
  after?: string
}

export interface Diff {
  summary: Record<string, boolean>
  changes: DiffChange[]
}

export interface ImproveResult {
  improved_testcase: TestCase
  issue_resolutions?: IssueResolution[]
  diff?: Diff
  warnings?: string[]
  validation_warnings?: string[]
  improvement_notes?: string[]
  manual_notes?: string[]
  display_duration?: string
}

export interface AnalyzeResult {
  summary: string
  issues: ReviewIssue[]
  original_normalized_testcase?: Record<string, unknown>
  warnings?: string[]
}

export interface DraftResult {
  work_item_id: string
  global_id?: string
  title: string
  testit_url?: string
}

export interface OpStatus {
  msg: string
  type: StatusType
}
