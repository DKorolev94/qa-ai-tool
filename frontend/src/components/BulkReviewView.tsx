import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, Play, RotateCw, Square, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { DEFAULT_RULES, buildFallbackConfig } from '../reviewConfigFallback'
import { ModeButton } from './ModeButton'
import { SectionHeader } from './SectionHeader'
import type { BulkReviewItemResult, BulkReviewJobStatus, ReviewConfig, ReviewRuleId } from '../types'

const POLL_INTERVAL_MS = 2000
const MAX_CONSECUTIVE_POLL_FAILURES = 5
const MAX_IDS_PER_BATCH = 200
const CONFIRM_THRESHOLD = 10

function parseIds(raw: string): string[] {
  return Array.from(new Set(raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)))
}

function ItemRow({
  item, index, canRetry, onRetry,
}: {
  item: BulkReviewItemResult
  index: number
  canRetry: boolean
  onRetry: (index: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const isRunning = item.status !== 'done' && item.status !== 'error' && item.status !== 'cancelled'
  const hasNotes = item.status === 'done' && item.manual_notes.length > 0
  const isRetryable = canRetry && (item.status === 'error' || item.status === 'cancelled')

  // canRetry (job-level "done") flips true→false the instant any retry
  // starts and back to true once it resolves — that's exactly when a
  // previously-clicked retry on this row (if any) is over.
  useEffect(() => {
    if (canRetry) setRetrying(false)
  }, [canRetry])
  return (
    <div className={`bulk-review-row-wrap${expanded ? ' bulk-review-row-wrap--open' : ''}`}>
      <div
        className={`bulk-review-row${hasNotes ? ' bulk-review-row--clickable' : ''}`}
        onClick={hasNotes ? () => setExpanded(v => !v) : undefined}
      >
        <span className="bulk-review-row-icon">
          {item.status === 'done' && !item.needs_manual_review && <CheckCircle2 size={14} strokeWidth={2} style={{ color: 'var(--ok)' }} />}
          {item.status === 'done' && item.needs_manual_review && <AlertTriangle size={14} strokeWidth={2} style={{ color: '#F59E0B' }} />}
          {item.status === 'error' && <XCircle size={14} strokeWidth={2} style={{ color: 'var(--bad)' }} />}
          {item.status === 'cancelled' && <Ban size={14} strokeWidth={2} style={{ color: 'var(--tx-dim)' }} />}
          {isRunning && <Loader2 size={14} className="spin-icon" />}
        </span>
        <span className="bulk-review-row-id">#{item.work_item_id}</span>
        <span className="bulk-review-row-status">{t(`bulkReview.status.${item.status}`)}</span>
        <span className="bulk-review-row-detail">
          {item.status === 'error' && item.error}
          {item.status === 'done' && item.issues_count === 0 && t('bulkReview.noIssuesFound')}
          {item.status === 'done' && item.issues_count > 0 && t('bulkReview.issuesFound', { count: item.issues_count })}
          {item.status === 'done' && item.needs_manual_review && ` · ${t('bulkReview.needsManualReview')}`}
        </span>
        {item.testit_url && (
          <a
            className="bulk-review-row-link"
            href={item.testit_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >
            {t('bulkReview.openInTestIt')}
            <ExternalLink size={11} strokeWidth={2} />
          </a>
        )}
        {isRetryable && (
          <button
            type="button"
            className="bulk-review-row-retry"
            disabled={retrying}
            onClick={e => { e.stopPropagation(); setRetrying(true); onRetry(index).catch(() => setRetrying(false)) }}
          >
            {retrying ? <Loader2 size={11} className="spin-icon" /> : <RotateCw size={11} strokeWidth={2} />}
            {t('bulkReview.retry')}
          </button>
        )}
        {hasNotes && <ChevronDown size={12} className={`bulk-review-row-chevron${expanded ? ' open' : ''}`} />}
      </div>
      {expanded && hasNotes && (
        <ul className="bulk-review-row-notes">
          {item.manual_notes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      )}
    </div>
  )
}

function Summary({ items }: { items: BulkReviewItemResult[] }) {
  const { t } = useTranslation()
  const done = items.filter(i => i.status === 'done')
  if (done.length === 0) return null
  const needsReview = done.filter(i => i.needs_manual_review).length
  const ready = done.length - needsReview
  return (
    <div className="bulk-review-summary">
      {t('bulkReview.summaryReady', { count: ready })}
      {needsReview > 0 && ` · ${t('bulkReview.summaryNeedsReview', { count: needsReview })}`}
    </div>
  )
}

function jobIdsPreview(job: BulkReviewJobStatus): string {
  const ids = job.items.slice(0, 3).map(i => `#${i.work_item_id}`).join(', ')
  return job.items.length > 3 ? `${ids}, +${job.items.length - 3}` : ids
}

function RecentJobsList({ jobs, onOpen }: { jobs: BulkReviewJobStatus[]; onOpen: (job: BulkReviewJobStatus) => void }) {
  const { t } = useTranslation()
  if (jobs.length === 0) return null
  return (
    <div className="bulk-review-recent">
      <span className="bulk-review-recent-label">{t('bulkReview.recentBatches')}</span>
      <div className="hist-list">
        {jobs.slice(0, 8).map(job => (
          <div key={job.job_id} className="hist-item" onClick={() => onOpen(job)}>
            {job.done
              ? <CheckCircle2 size={14} strokeWidth={2} style={{ color: 'var(--ok)', flexShrink: 0 }} />
              : <Loader2 size={14} className="spin-icon" style={{ flexShrink: 0 }} />}
            <span className="hist-title">{jobIdsPreview(job)}</span>
            <span className="hist-meta">
              {job.done ? t('bulkReview.batchDone') : t('bulkReview.batchRunning')}
            </span>
            <ChevronRight size={14} strokeWidth={1.75} className="hist-chevron" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function BulkReviewView() {
  const { t, i18n } = useTranslation()
  const [idsInput, setIdsInput] = useState('')
  const [reviewConfig, setReviewConfig] = useState<ReviewConfig>(() => buildFallbackConfig(i18n.language))
  const [selectedPreset, setSelectedPreset] = useState('strict')
  const [enabledRules, setEnabledRules] = useState<ReviewRuleId[]>(DEFAULT_RULES)
  const hasLoadedRulesRef = useRef(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [items, setItems] = useState<BulkReviewItemResult[]>([])
  const [jobDone, setJobDone] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [pendingConfirmIds, setPendingConfirmIds] = useState<string[] | null>(null)
  const [recentJobs, setRecentJobs] = useState<BulkReviewJobStatus[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollFailuresRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  useEffect(() => {
    api.getReviewConfig()
      .then(config => {
        setReviewConfig(config)
        if (!hasLoadedRulesRef.current) {
          setEnabledRules(config.defaults['testit'] ?? DEFAULT_RULES)
          hasLoadedRulesRef.current = true
        }
      })
      .catch(() => setReviewConfig(buildFallbackConfig(i18n.language)))
  }, [i18n.language])

  // Lets someone who started a batch, navigated away, and came back (or
  // started several in a row) find and reopen/stop any of them — not just
  // the one this page instance still holds in state. Keeps refreshing while
  // any listed batch is still running, so "Running…" doesn't go stale while
  // this screen just sits open.
  useEffect(() => {
    if (jobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      api.listBulkReviewJobs()
        .then(jobs => {
          if (cancelled) return
          setRecentJobs(jobs)
          if (jobs.some(j => !j.done)) {
            timer = setTimeout(refresh, POLL_INTERVAL_MS)
          }
        })
        .catch(() => {})
    }
    refresh()

    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [jobId])

  function startPolling(id: string) {
    pollFailuresRef.current = 0
    if (pollRef.current) clearInterval(pollRef.current)
    const poll = async () => {
      try {
        const status = await api.getBulkReviewStatus(id)
        if (!mountedRef.current) return
        pollFailuresRef.current = 0
        setItems(status.items)
        if (status.done) {
          setJobDone(true)
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        if (!mountedRef.current) return
        pollFailuresRef.current += 1
        if (pollFailuresRef.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
          if (pollRef.current) clearInterval(pollRef.current)
          setPollError(t('bulkReview.pollError'))
        }
      }
    }
    poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS)
  }

  async function runBatch(ids: string[]) {
    setStartError(null)
    setPollError(null)
    setStarting(true)
    try {
      const { job_id } = await api.startBulkReview({ work_item_ids: ids, enabled_rules: enabledRules })
      setJobId(job_id)
      setJobDone(false)
      setItems(ids.map(id => ({
        work_item_id: id, status: 'pending', issues_count: 0,
        needs_manual_review: false, manual_notes: [],
      })))
      startPolling(job_id)
    } catch (err) {
      setStartError((err as Error).message)
    } finally {
      setStarting(false)
    }
  }

  function handleStart() {
    const ids = parseIds(idsInput)
    if (ids.length === 0) {
      setStartError(t('bulkReview.emptyIdsError'))
      return
    }
    if (ids.length > MAX_IDS_PER_BATCH) {
      setStartError(t('bulkReview.tooManyIdsError', { max: MAX_IDS_PER_BATCH, count: ids.length }))
      return
    }
    if (ids.length > CONFIRM_THRESHOLD) {
      setStartError(null)
      setPendingConfirmIds(ids)
      return
    }
    runBatch(ids)
  }

  function handleConfirmStart() {
    if (!pendingConfirmIds) return
    const ids = pendingConfirmIds
    setPendingConfirmIds(null)
    runBatch(ids)
  }

  function handleCancelConfirm() {
    setPendingConfirmIds(null)
  }

  function openJob(job: BulkReviewJobStatus) {
    setPollError(null)
    setJobId(job.job_id)
    setItems(job.items)
    setJobDone(job.done)
    if (!job.done) startPolling(job.job_id)
  }

  async function handleStop() {
    if (!jobId) return
    setStopping(true)
    try {
      await api.stopBulkReview(jobId)
    } catch { /* the next poll tick will reflect whatever the backend ends up in */ }
    finally {
      setStopping(false)
    }
  }

  async function handleRetry(index: number) {
    if (!jobId) return
    // Let the caller (ItemRow) catch failures so it can reset its own
    // "retrying" spinner — swallowing the error here left it stuck forever.
    await api.retryBulkReviewItem(jobId, index)
    setJobDone(false)
    startPolling(jobId)
  }

  function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current)
    setJobId(null)
    setItems([])
    setJobDone(false)
    setPollError(null)
    setIdsInput('')
  }

  if (jobId) {
    return (
      <div className="workspace-inner-wb">
        <SectionHeader
          title={t('sidebar.bulkReview')}
          subtitle={t('bulkReview.subtitle')}
          onBack={handleReset}
          actions={!jobDone && (
            <button
              type="button"
              className="session-stop-btn"
              onClick={handleStop}
              disabled={stopping}
              title={t('bulkReview.stopHint')}
            >
              <Square size={11} strokeWidth={2} /> {t('bulkReview.stop')}
            </button>
          )}
        />
        <Summary items={items} />
        <div className="bulk-review-list">
          {items.map((item, idx) => (
            <ItemRow key={idx} item={item} index={idx} canRetry={jobDone} onRetry={handleRetry} />
          ))}
        </div>
        {pollError && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
            <span className="alert-text">{pollError}</span>
          </div>
        )}
        {jobDone && (
          <button type="button" className="source-fetch-btn" onClick={handleReset} style={{ marginTop: 16 }}>
            {t('bulkReview.startNew')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="workspace-inner">
      <div className="workspace-col">
        <SectionHeader
          title={t('sidebar.bulkReview')}
          subtitle={t('bulkReview.subtitle')}
          actions={
            <ModeButton
              reviewConfig={reviewConfig}
              selectedPreset={selectedPreset}
              enabledRules={enabledRules}
              onApply={(preset, rules) => { setSelectedPreset(preset); setEnabledRules(rules) }}
            />
          }
        />
        <div className="source-panel">
          <div className="source-body">
            <div>
              <label className="source-label" htmlFor="bulk-review-ids">{t('bulkReview.idsLabel')}</label>
              <textarea
                id="bulk-review-ids"
                className="runner-task-textarea"
                placeholder={t('bulkReview.idsPlaceholder')}
                value={idsInput}
                onChange={e => setIdsInput(e.target.value)}
                rows={6}
              />
            </div>
            {startError && (
              <div className="alert alert-error">
                <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
                <span className="alert-text">{startError}</span>
              </div>
            )}
            {pendingConfirmIds ? (
              <div className="bulk-review-confirm">
                <div className="limits-callout">
                  <AlertTriangle size={14} strokeWidth={1.5} />
                  <div className="limits-callout-text">
                    <span>{t('bulkReview.confirmLargeBatch', { count: pendingConfirmIds.length })}</span>
                  </div>
                </div>
                <div className="bulk-review-confirm-actions">
                  <button type="button" className="runner-cta-btn" onClick={handleConfirmStart} disabled={starting}>
                    {starting ? <Loader2 size={16} className="spin-icon" /> : <Play size={16} />}
                    {t('bulkReview.confirmStart', { count: pendingConfirmIds.length })}
                  </button>
                  <button type="button" className="source-fetch-btn" onClick={handleCancelConfirm} disabled={starting}>
                    {t('bulkReview.confirmCancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="runner-cta-btn" onClick={handleStart} disabled={starting}>
                {starting ? <Loader2 size={16} className="spin-icon" /> : <Play size={16} />}
                {t('bulkReview.start')}
              </button>
            )}
          </div>
        </div>
        <RecentJobsList jobs={recentJobs} onOpen={openJob} />
      </div>
    </div>
  )
}
