import { RunRecord, RunSummary, StepRecord } from './types.js'

type Subscriber = (msg: string) => void

interface WsQueue {
  push: (msg: string) => void
  drain: () => string[]
  subscribe: (fn: Subscriber) => () => void
  readonly closed: boolean
  close: () => void
}

function makeQueue(): WsQueue {
  const buffer: string[] = []
  const subscribers = new Set<Subscriber>()
  let closed = false

  return {
    push(msg: string) {
      buffer.push(msg)
      subscribers.forEach(fn => fn(msg))
    },
    drain() {
      return [...buffer]
    },
    subscribe(fn: Subscriber) {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    get closed() { return closed },
    close() {
      closed = true
      subscribers.clear()
    },
  }
}

const _runs = new Map<string, RunRecord>()
const _queues = new Map<string, WsQueue>()

export function createRun(run_id: string, test_case_id: string): RunRecord {
  const record: RunRecord = {
    run_id,
    test_case_id,
    status: 'running',
    summary: '',
    steps: [],
    errors: [],
    duration_sec: 0,
    created_at: new Date().toISOString(),
  }
  _runs.set(run_id, record)
  _queues.set(run_id, makeQueue())
  return record
}

export function getQueue(run_id: string): WsQueue | undefined {
  return _queues.get(run_id)
}

export function getRecord(run_id: string): RunRecord | undefined {
  return _runs.get(run_id)
}

export function pushStep(run_id: string, step: StepRecord): void {
  const rec = _runs.get(run_id)
  if (rec) rec.steps.push(step)
}

export function finishRun(
  run_id: string,
  patch: Pick<RunRecord, 'status' | 'summary' | 'errors' | 'duration_sec'>
): void {
  const rec = _runs.get(run_id)
  if (rec) Object.assign(rec, patch)
  _queues.get(run_id)?.close()
}

export function listRuns(limit = 20): RunSummary[] {
  return [..._runs.values()]
    .filter(r => r.status !== 'running')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map(r => ({
      run_id: r.run_id,
      test_case_id: r.test_case_id || null,
      status: r.status as RunSummary['status'],
      duration_sec: r.duration_sec,
      steps_count: r.steps.length,
      created_at: r.created_at,
    }))
}
