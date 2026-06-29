import {
  CheckCircle2, Clock3, FileText, List, Lock, Loader2, Shield, ShieldCheck, Upload, XCircle,
} from 'lucide-react'
import type { FetchResult } from '../types'

interface SourcePanelProps {
  testItId: string
  onTestItIdChange: (v: string) => void
  fetchLoading: boolean
  fetchResult: FetchResult | null
  fetchError: string | null
  onFetch: () => void
  presetLabel: string
  enabledRulesCount: number
}

export function SourcePanel({
  testItId, onTestItIdChange, fetchLoading, fetchResult, fetchError,
  onFetch, presetLabel, enabledRulesCount,
}: SourcePanelProps) {
  const canFetch = testItId.trim().length > 0 && !fetchLoading

  return (
    <div className="source-panel">
      <div className="source-body">
        {/* TMS card */}
        <div className="tms-grid">
          <div className="tms-card tms-card-active">
            <div className="tms-icon">
              <img src="/icons/testit.png" width={20} height={20} alt="TestIT" style={{ objectFit: 'contain' }} />
            </div>
            <div className="tms-copy"><div className="tms-name">TestIT</div></div>
          </div>
        </div>

        {/* Input */}
        <div>
          <label className="source-label" htmlFor="testit-id">Test case ID in TestIT</label>
          <div className="source-input-row">
            <input
              id="testit-id"
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
                ? <><Loader2 size={15} className="spinner" />Loading...</>
                : <><Upload size={15} />Load</>
              }
            </button>
          </div>
        </div>

        {/* Error alert */}
        {fetchError && (
          <div className="alert alert-error">
            <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
            <span className="alert-text"><strong>Error: </strong>{fetchError}</span>
          </div>
        )}

        {/* Success alert */}
        {fetchResult && (
          <div className="alert alert-success">
            <span className="alert-icon-ok"><CheckCircle2 size={16} strokeWidth={1.75} /></span>
            <span className="alert-text"><strong>Loaded: </strong>{fetchResult.normalized_testcase.title}</span>
            <span className="alert-id">{fetchResult.work_item_id}</span>
          </div>
        )}

        {/* Status chips */}
        <div className="status-bar">
          <div className="status-chip">
            <span className="status-chip-icon"><Clock3 size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-label">Mode</span>
            <span className="status-chip-value">{presetLabel}</span>
          </div>
          <div className="status-chip">
            <span className="status-chip-icon"><ShieldCheck size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-value">{enabledRulesCount} rules</span>
          </div>
        </div>

        {/* Info cards */}
        <div className="info-grid">
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><List size={14} strokeWidth={1.75} /></span>
              How it works
            </div>
            <div className="info-steps">
              <div className="info-step"><span className="info-step-num">1</span>Load test case by ID</div>
              <div className="info-step"><span className="info-step-num">2</span>Review issues found by AI</div>
              <div className="info-step"><span className="info-step-num">3</span>Apply improvements</div>
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><FileText size={14} strokeWidth={1.75} /></span>
              What gets loaded
            </div>
            <div className="info-card-body">
              Title, description, preconditions, steps, postconditions and metadata.
            </div>
            <div className="info-tag">
              <Lock size={10} strokeWidth={2} />
              Read only
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><Shield size={14} strokeWidth={1.75} /></span>
              Review mode
            </div>
            <div className="info-card-body">
              Checks are configured via review mode and custom rules.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
