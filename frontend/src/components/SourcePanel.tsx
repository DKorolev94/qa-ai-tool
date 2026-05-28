import { useRef } from 'react'
import type { FetchResult, SourceMode } from '../types'

function normalizeMultiline(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\\n/g, '\n')
}

function normalizeCompact(text: string | null | undefined): string {
  return normalizeMultiline(text).replace(/\n{2,}/g, '\n').trim()
}

function splitCompactLines(text: string | null | undefined): string[] {
  return normalizeCompact(text)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

interface Props {
  mode: SourceMode
  onModeChange: (m: SourceMode) => void
  testItId: string
  onTestItIdChange: (v: string) => void
  manualText: string
  onManualTextChange: (v: string) => void
  fetchResult: FetchResult | null
  fetchError: string | null
  fetchLoading: boolean
  onFetch: () => void
  canReview: boolean
  onAnalyze: () => void
  analyzeLoading: boolean
  active?: boolean
  canImprove?: boolean
  onImprove?: () => void
  improveLoading?: boolean
}

export function SourcePanel({
  mode, onModeChange,
  testItId, onTestItIdChange,
  manualText, onManualTextChange,
  fetchResult, fetchError, fetchLoading,
  onFetch,
  canReview,
  onAnalyze,
  analyzeLoading,
  active,
  canImprove = false,
  onImprove,
  improveLoading = false,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const anyLoading = fetchLoading || analyzeLoading || improveLoading

  function triggerPrimaryAction() {
    if (anyLoading) return
    if (canImprove && onImprove) onImprove()
    else if (canReview) onAnalyze()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      triggerPrimaryAction()
    }
  }

  return (
    <div className={`panel flex flex-col${active ? ' panel-active' : ''}`}>
      <div className="panel-header">
        <div className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
        <span className="text-sm font-semibold text-tx-primary flex-1">Источник</span>

        <div className="flex gap-0.5 p-0.5 bg-bg-hover rounded-md border border-line">
          <button
            onClick={() => onModeChange('testit')}
            className={[
              'px-3 py-1 text-xs font-medium rounded transition-all duration-150',
              mode === 'testit'
                ? 'bg-bg-panel text-tx-primary shadow-card'
                : 'text-tx-muted hover:text-tx-secondary',
            ].join(' ')}
          >
            TestIT
          </button>
          <div className="relative group">
            <button
              disabled
              className="px-3 py-1 text-xs font-medium rounded transition-all duration-150 text-tx-dim cursor-not-allowed opacity-50 flex items-center gap-1"
            >
              Вручную
              <span className="text-[9px] font-semibold uppercase tracking-wide bg-accent/15 text-accent px-1 py-0.5 rounded">
                скоро
              </span>
            </button>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2.5 py-1.5 rounded-md text-xs text-tx-secondary bg-bg-panel border border-line shadow-card whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50">
              В разработке
            </div>
          </div>
        </div>
      </div>

      <div className="panel-body flex flex-col gap-4" onKeyDown={handleKeyDown}>
        {mode === 'testit' ? (
          <TestITSource
            id={testItId}
            onIdChange={onTestItIdChange}
            loading={fetchLoading}
            onFetch={onFetch}
            onPrimaryAction={triggerPrimaryAction}
            result={fetchResult}
            error={fetchError}
            disabled={anyLoading}
          />
        ) : (
          <ManualSource
            value={manualText}
            onChange={onManualTextChange}
            textareaRef={textareaRef}
            disabled={anyLoading}
            onPrimaryAction={triggerPrimaryAction}
          />
        )}
      </div>

      <div className="panel-footer flex flex-col gap-2">
        <div className="flex items-center justify-end">
          <span className="text-[10px] text-tx-dim font-mono">Ctrl+Enter — анализировать</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`btn flex-1 ${canImprove ? 'btn-secondary' : 'btn-primary'}`}
            onClick={onAnalyze}
            disabled={!canReview || anyLoading}
          >
            {analyzeLoading ? <Spinner /> : null}
            {analyzeLoading ? 'Анализирую…' : 'Анализировать'}
          </button>
          {canImprove && (
            <button
              className="btn btn-primary flex-1"
              onClick={onImprove}
              disabled={anyLoading}
            >
              {improveLoading ? <Spinner /> : null}
              {improveLoading ? 'Улучшаю…' : 'Улучшить'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function TestITSource({
  id, onIdChange, loading, onFetch, onPrimaryAction, result, error, disabled,
}: {
  id: string
  onIdChange: (v: string) => void
  loading: boolean
  onFetch: () => void
  onPrimaryAction: () => void
  result: FetchResult | null
  error: string | null
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="section-label mb-0">ID тест-кейса</label>
        </div>
        <div className="flex gap-2 mt-1.5">
          <input
            className="input flex-1"
            placeholder="например, 6109"
            value={id}
            onChange={(e) => onIdChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                onPrimaryAction()
                return
              }
              onFetch()
            }}
            disabled={disabled}
            spellCheck={false}
          />
          <button
            className="btn btn-secondary flex-shrink-0 min-w-[80px]"
            onClick={onFetch}
            disabled={!id.trim() || disabled}
          >
            {loading ? <Spinner /> : null}
            {loading ? '' : 'Загрузить'}
          </button>
        </div>
      </div>

      {result && !loading && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-line bg-bg-surface text-xs">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
          <span className="text-tx-secondary">Кейс загружен из TestIT</span>
          <span className="text-tx-dim font-mono ml-auto">#{result.work_item_id}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 p-3 bg-bad/5 border border-bad/20 rounded-lg animate-slide-up">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 mt-0.5 text-bad">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M7 4.5v3M7 9.5v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="text-xs text-bad font-mono leading-relaxed whitespace-pre-line">{normalizeMultiline(error)}</span>
        </div>
      )}

      {loading && !result && (
        <div className="flex flex-col gap-2.5 animate-fade-in">
          <div className="skeleton h-5 w-3/4 rounded-md" />
          <div className="skeleton h-3.5 w-1/2 rounded" />
          <div className="skeleton h-3.5 w-2/3 rounded" />
        </div>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-center animate-fade-in">
          <div className="w-10 h-10 rounded-xl bg-bg-surface border border-line flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="3" y="2" width="12" height="14" rx="1.5" stroke="#BFC6D4" strokeWidth="1.4" />
              <path d="M6 6h6M6 9h6M6 12h4" stroke="#BFC6D4" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-tx-secondary">Тест-кейс не загружен</p>
            <p className="text-xs text-tx-muted max-w-[160px] leading-relaxed">
              Введите ID и нажмите «Загрузить»
            </p>
          </div>
        </div>
      )}

      {result && !loading && <FetchPreview result={result} />}
    </div>
  )
}

function FetchPreview({ result }: { result: FetchResult }) {
  const tc = result.normalized_testcase
  const allSteps = [
    ...(tc.preconditions?.length ? [{ label: 'Предусловия', steps: tc.preconditions }] : []),
    ...(tc.steps?.length ? [{ label: 'Шаги', steps: tc.steps }] : []),
    ...(tc.postconditions?.length ? [{ label: 'Постусловия', steps: tc.postconditions }] : []),
  ]

  return (
    <div className="border border-line rounded-xl bg-bg-surface flex flex-col gap-0 animate-slide-up overflow-hidden">
      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-line">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex h-5 items-center gap-1.5 font-mono text-xs font-semibold leading-none px-2 rounded-md bg-accent-dim text-accent">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="block flex-shrink-0">
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3.5 5l1 1 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="leading-none">#{result.work_item_id}</span>
          </span>
          {tc.tags?.map((t) => <span key={t} className="tag-pill">{t}</span>)}
        </div>

        {tc.title && (
          <p className="text-sm text-tx-primary font-semibold leading-snug whitespace-pre-line">
            {normalizeMultiline(tc.title)}
          </p>
        )}

        {tc.description && (
          <p className="text-xs text-tx-secondary leading-relaxed whitespace-pre-line max-h-[90px] overflow-y-auto pr-1">
            {normalizeMultiline(tc.description)}
          </p>
        )}

        <div className="flex items-center gap-2.5 flex-wrap text-xs text-tx-muted font-mono">
          {tc.priority && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-line bg-bg-panel">
              <span className="w-1.5 h-1.5 rounded-full bg-warn" />
              {tc.priority}
            </span>
          )}
          {tc.status && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-line bg-bg-panel">
              {tc.status}
            </span>
          )}
          {tc.steps?.length ? (
            <span className="text-accent font-medium">{tc.steps.length} шагов</span>
          ) : null}
        </div>
      </div>

      {allSteps.length > 0 && (
        <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
          {allSteps.map(({ label, steps }) => (
            <div key={label} className="border-b border-line last:border-b-0">
              {allSteps.length > 1 && (
                <div className="flex items-center px-3 h-7 bg-bg-surface border-b border-line">
                  <span className="text-2xs font-mono uppercase tracking-widest text-tx-muted font-medium leading-none">
                    {label}
                  </span>
                </div>
              )}
              <ol className="flex flex-col px-3 pb-1">
                {steps.map((step, i) => (
                  <li key={i} className="flex gap-3 py-2 border-b border-line last:border-b-0">
                    <span className="font-mono text-xs text-tx-muted flex-shrink-0 w-5 text-right mt-0.5 font-semibold">
                      {i + 1}.
                    </span>
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="text-xs text-tx-secondary leading-snug whitespace-pre-line">{normalizeCompact(step.action)}</span>
                      {step.expected && (
                        <div className="flex flex-col gap-0.5">
                          {splitCompactLines(step.expected).map((line, lineIdx) => (
                            <span key={lineIdx} className="text-xs text-ok/80 leading-snug">
                              ✓ {line}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {result.warnings?.length ? (
        <div className="flex flex-col gap-1 px-3 py-2 border-t border-line bg-warn/5">
          {result.warnings.map((w, i) => (
            <div key={i} className="text-xs text-warn flex gap-1.5">
              <span>⚠</span><span className="whitespace-pre-line">{normalizeCompact(w)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ManualSource({
  value, onChange, textareaRef, disabled, onPrimaryAction,
}: {
  value: string
  onChange: (v: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement>
  disabled: boolean
  onPrimaryAction: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="section-label mb-0">Тест-кейс (JSON или plain text)</label>
      </div>
      <textarea
        ref={textareaRef}
        className="textarea min-h-[190px] text-sm leading-relaxed"
        style={{ resize: 'vertical' }}
        placeholder={`Название теста\n\nПредусловие:\nПользователь зарегистрирован\n\nШаги:\n1. Открыть страницу\n2. Ввести данные\n3. Нажать Submit\n\nОжидаемый результат:\nПользователь авторизован\n\n— или вставь JSON тест-кейс`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            onPrimaryAction()
          }
        }}
        disabled={disabled}
        spellCheck={false}
      />
      <div className="flex items-center justify-between gap-2 text-xs font-mono text-tx-dim">
        <p>Вставь JSON или plain text — API распарсит автоматически</p>
        <span className="flex-shrink-0">{value.length} симв.</span>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray="24 12" opacity="0.8" />
    </svg>
  )
}
