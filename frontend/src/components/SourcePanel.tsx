import {
  CheckCircle2, Clock3, FileText, List, Lock, Loader2, Shield, ShieldCheck, Upload, XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          <label className="source-label" htmlFor="testit-id">{t('sourcePanel.testCaseIdLabel')}</label>
          <div className="source-input-row">
            <input
              id="testit-id"
              className="source-id-input"
              type="text"
              placeholder={t('sourcePanel.idPlaceholder')}
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
                ? <><Loader2 size={15} className="spinner" />{t('sourcePanel.loading')}</>
                : <><Upload size={15} />{t('sourcePanel.load')}</>
              }
            </button>
          </div>
        </div>

        {/* Error alert */}
        {fetchError && (
          <div className="alert alert-error">
            <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
            <span className="alert-text"><strong>{t('sourcePanel.error')}</strong>{fetchError}</span>
          </div>
        )}

        {/* Success alert */}
        {fetchResult && (
          <div className="alert alert-success">
            <span className="alert-icon-ok"><CheckCircle2 size={16} strokeWidth={1.75} /></span>
            <span className="alert-text"><strong>{t('sourcePanel.loaded')}</strong>{fetchResult.normalized_testcase.title}</span>
            <span className="alert-id">{fetchResult.work_item_id}</span>
          </div>
        )}

        {/* Status chips */}
        <div className="status-bar">
          <div className="status-chip">
            <span className="status-chip-icon"><Clock3 size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-label">{t('sourcePanel.modeLabel')}</span>
            <span className="status-chip-value">{presetLabel}</span>
          </div>
          <div className="status-chip">
            <span className="status-chip-icon"><ShieldCheck size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-value">{t('sourcePanel.rulesCount', { count: enabledRulesCount })}</span>
          </div>
        </div>

        {/* Info cards */}
        <div className="info-grid">
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><List size={14} strokeWidth={1.75} /></span>
              {t('sourcePanel.howItWorksTitle')}
            </div>
            <div className="info-steps">
              <div className="info-step"><span className="info-step-num">1</span>{t('sourcePanel.step1')}</div>
              <div className="info-step"><span className="info-step-num">2</span>{t('sourcePanel.step2')}</div>
              <div className="info-step"><span className="info-step-num">3</span>{t('sourcePanel.step3')}</div>
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><FileText size={14} strokeWidth={1.75} /></span>
              {t('sourcePanel.whatGetsLoadedTitle')}
            </div>
            <div className="info-card-body">
              {t('sourcePanel.whatGetsLoadedBody')}
            </div>
            <div className="info-tag">
              <Lock size={10} strokeWidth={2} />
              {t('sourcePanel.readOnly')}
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><Shield size={14} strokeWidth={1.75} /></span>
              {t('sourcePanel.reviewModeTitle')}
            </div>
            <div className="info-card-body">
              {t('sourcePanel.reviewModeBody')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
