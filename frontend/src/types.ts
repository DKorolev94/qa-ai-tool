export type SourceMode = 'testit' | 'manual'
export type ReviewRuleId =
  | 'structure'
  | 'description'
  | 'expected_results'
  | 'test_data'
  | 'tags'
  | 'duration'
  | 'atomicity'
  | 'independence'
  | 'requirement_traceability'
export type Severity = 'high' | 'medium' | 'low'
export type ResolutionStatus = 'resolved' | 'manual_needed' | 'skipped'
export type StatusType = 'success' | 'error' | 'loading' | ''

export interface Step {
  action: string
  expected?: string | null
  test_data?: string | null
  comments?: string | null
}

export interface ParameterTable {
  names: string[]
  rows: string[][]
}

export interface WorkItemLink {
  url?: string | null
  title?: string | null
  type?: string | null
  description?: string | null
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
  links?: WorkItemLink[]
  attachments?: Array<{ name?: string; url?: string | null; type?: string | null; file_id?: string }>
  attributes?: Record<string, unknown>
  parameter_table?: ParameterTable | null
  section_name?: string | null
  product_versions?: string[]
}

export interface FetchResult {
  work_item_id: string
  normalized_testcase: TestCase
  raw_work_item: Record<string, unknown>
  warnings?: string[]
}

export interface ReviewIssue {
  rule?: string
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
  issue_index: number
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
  original_normalized_testcase?: Record<string, unknown>
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

export interface ReviewSourceConfig {
  id: string
  label: string
  enabled: boolean
  badge?: string | null
}

export interface ReviewProfileConfig {
  id: string
  label: string
  description?: string
  rules: ReviewRuleId[]
}

export interface ReviewRuleConfig {
  id: ReviewRuleId
  label: string
  description?: string
  group?: string
  default_for?: string[]
  profiles?: string[]
  enabled: boolean
  order: number
}

export interface ReviewConfig {
  sources: ReviewSourceConfig[]
  profiles: ReviewProfileConfig[]
  rules: ReviewRuleConfig[]
  defaults: Record<string, ReviewRuleId[]>
}

export interface ApplyResult {
  work_item_id: string
  global_id?: number
  title: string
  testit_url?: string
}

export interface ActionNotification {
  type: 'apply' | 'draft'
  id: string
  testit_url?: string
  sectionName?: string
  isPartial?: boolean
}

export interface Section {
  id: string
  name: string
}
