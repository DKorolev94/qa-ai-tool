// API contract mirrors browser-use-runner for backend compatibility

export interface RunRequest {
  test_case_id: string
  task: string
  start_url?: string
  max_steps?: number
  headless?: boolean
  llm_model?: string
  llm_base_url?: string
  llm_api_key?: string
}

export interface StepRecord {
  step: number
  status: 'ok' | 'error'
  summary: string
  url: string | null
  duration_sec: number
  screenshot_path?: string
  screenshot_b64?: string
}

export interface RunRecord {
  run_id: string
  test_case_id: string
  status: 'running' | 'passed' | 'failed' | 'blocked' | 'error'
  summary: string
  steps: StepRecord[]
  errors: string[]
  duration_sec: number
  created_at: string
}

// Response for POST /run — matches browser-use-runner RunResponse
export interface RunResponse {
  run_id: string
  status: 'passed' | 'failed' | 'blocked'
  summary: string
  steps_count: number
  errors: string[]
  duration_sec: number
  artifacts: {
    screenshot_paths: string[]
  }
}

// WebSocket events — matching browser-use-runner wire format
export interface StepEvent {
  type: 'step'
  step: number
  url: string
  title: string
  next_goal: string
  screenshot_b64?: string
  elapsed_sec: number
}

export interface DoneEvent {
  type: 'done'
  status: 'passed' | 'failed' | 'blocked'
  summary: string
  duration_sec: number
  steps_count: number
  errors: string[]
  run_id: string | null
}

export interface ErrorEvent {
  type: 'error'
  message: string
}

export type WsEvent = StepEvent | DoneEvent | ErrorEvent

// GET /runs list item
export interface RunSummary {
  run_id: string
  test_case_id: string | null
  status: 'passed' | 'failed' | 'blocked' | 'error'
  duration_sec: number
  steps_count: number
  created_at: string
}

// GET /runs/:id/steps — matches browser-use-runner ui/steps.json format
export interface UiStep {
  step: number
  status: 'ok' | 'error'
  summary: string
  url: string | null
  duration_sec: number | null
  screenshot: {
    path: string
    url?: string
    size_bytes: number
  } | null
}
