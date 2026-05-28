import type { ReviewIssue, ReviewResult, Severity } from '../types'

interface Props {
  result: ReviewResult | null
  loading: boolean
  error: string | null
  issueChecked: boolean[]
  onIssueCheck: (idx: number, checked: boolean) => void
}


const severityLabel: Record<Severity, string> = {
  high: 'Критично',
  medium: 'Средний',
  low: 'Низкий',
}


const severityPriorityClass: Record<Severity, string> = {
  high: 'text-sev-high bg-sev-high-bg border-sev-high-border',
  medium: 'text-sev-med bg-sev-med-bg border-sev-med-border',
  low: 'text-sev-low bg-sev-low-bg border-sev-low-border',
}

const issueCardClass: Record<Severity, string> = {
  high: 'issue-card issue-card-high',
  medium: 'issue-card issue-card-med',
  low: 'issue-card issue-card-low',
}

function normalizeMultiline(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\\n/g, '\n')
}


export function ReviewPanel({ result, loading, error, issueChecked, onIssueCheck }: Props) {
  const isEmpty = !result && !loading && !error

  return (
    <div className={`panel flex flex-col ${result ? 'panel-active' : ''}`}>
      <div className="panel-header">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-300 ${
          result ? 'bg-ok' : loading ? 'bg-accent animate-pulse' : 'bg-tx-dim'
        }`} />
        <span className="text-sm font-semibold text-tx-primary flex-1">Ревью</span>
        {result?.issues?.length ? (
          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-accent-dim text-accent">
            замечаний: {result.issues.length}
          </span>
        ) : null}
        {result?.warnings?.length ? (
          <span className="text-xs font-mono text-warn bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
            ⚠ {result.warnings.length}
          </span>
        ) : null}
      </div>

      <div className="panel-body flex flex-col gap-4">
        {loading && <ReviewSkeleton />}
        {error && !loading && <ErrorBlock msg={error} />}
        {isEmpty && !loading && !error && <EmptyState />}
        {result && !loading && (
          <ReviewContent
            result={result}
            issueChecked={issueChecked}
            onIssueCheck={onIssueCheck}
          />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center animate-fade-in">
      <div className="w-12 h-12 rounded-xl bg-bg-surface border border-line flex items-center justify-center mb-1">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M4 10.5l3 3 6-6" stroke="#BFC6D4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="10" cy="10" r="7.5" stroke="#BFC6D4" strokeWidth="1.5" />
        </svg>
      </div>
      <p className="text-sm text-tx-muted max-w-[180px] leading-relaxed">
        Загрузите тест-кейс и нажмите «Анализировать»
      </p>
      <p className="text-xs text-tx-dim">Ctrl+Enter — быстрый запуск</p>
    </div>
  )
}

function ErrorBlock({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-3 p-3.5 bg-bad/5 border border-bad/20 rounded-lg text-sm text-bad animate-slide-up">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="font-mono text-xs leading-relaxed whitespace-pre-line">{normalizeMultiline(msg)}</span>
    </div>
  )
}

function ReviewSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-5/6" />
      <div className="skeleton h-4 w-4/6" />
      <div className="mt-2 skeleton h-20 w-full rounded-lg" />
      <div className="skeleton h-20 w-full rounded-lg" />
      <div className="skeleton h-16 w-full rounded-lg" />
    </div>
  )
}

function ReviewContent({
  result, issueChecked, onIssueCheck,
}: {
  result: ReviewResult
  issueChecked: boolean[]
  onIssueCheck: (idx: number, checked: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-3 animate-slide-up">
      {result.summary && (
        <div className="flex gap-2.5 p-3 bg-accent-dim rounded-lg border border-accent/15">
          <div className="w-0.5 bg-accent rounded-full flex-shrink-0" />
          <p className="text-sm text-tx-secondary leading-relaxed whitespace-pre-line">{normalizeMultiline(result.summary)}</p>
        </div>
      )}

      {result.issues?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="section-label mb-0">Проблемы ({result.issues.length})</span>
            <span className="text-xs text-tx-dim">Галка = исправлять при улучшении</span>
          </div>
          {result.issues.map((issue, idx) => (
            <IssueCard
              key={idx}
              issue={issue}
              idx={idx}
              checked={issueChecked[idx] ?? true}
              onCheck={(v) => onIssueCheck(idx, v)}
            />
          ))}
        </div>
      )}

      {result.warnings?.length ? (
        <div className="flex flex-col gap-1">
          {result.warnings.map((w, i) => (
            <div key={i} className="warn-item text-xs"><span>⚠</span><span className="whitespace-pre-line">{normalizeMultiline(w)}</span></div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function IssueCard({
  issue, idx, checked, onCheck,
}: {
  issue: ReviewIssue
  idx: number
  checked: boolean
  onCheck: (v: boolean) => void
}) {
  return (
    <div className={`${issueCardClass[issue.severity] ?? 'issue-card'} ${!checked ? 'excluded' : ''} p-3`}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 cursor-pointer rounded accent-[#5B5CF6]"
          title="Исправлять автоматически"
          aria-label={`Проблема ${idx + 1}: исправлять автоматически`}
        />

        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-sm text-tx-primary font-medium leading-snug flex-1 min-w-0">
              {issue.title}
            </span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border w-fit ${severityPriorityClass[issue.severity] ?? 'text-tx-muted border-line bg-bg-surface'}`}>
              {severityLabel[issue.severity] ?? issue.severity}
            </span>
          </div>

          <p className="text-xs text-tx-secondary leading-relaxed whitespace-pre-line">
            {normalizeMultiline(issue.description)}
          </p>

          {issue.recommendation && (
            <p className="text-xs text-accent leading-relaxed whitespace-pre-line">
              Рекомендация: {normalizeMultiline(issue.recommendation)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

