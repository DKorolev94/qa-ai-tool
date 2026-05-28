import { useCallback, useState } from 'react'
import type { Diff, DraftResult, ImproveResult, IssueResolution, ResolutionStatus, Step, TestCase } from '../types'

interface Props {
  result: ImproveResult | null
  loading: boolean
  error: string | null
  editableTC: TestCase | null
  onEditableChange: (tc: TestCase) => void
  draftResult: DraftResult | null
  draftError: string | null
  draftLoading: boolean
  onCopy: () => void
  onDownload: () => void
  onCreateDraft: () => void
  liveJson: string
}

const metaMap: Record<string, string> = {
  Ready: 'Готов',
  NeedsWork: 'Требует доработки',
  Highest: 'Критичный',
  High: 'Высокий',
  MEDIUM: 'Средний',
  Medium: 'Средний',
  LOW: 'Низкий',
  Low: 'Низкий',
}

function normalizeMultiline(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\\n/g, '\n')
}

function localizeMeta(value: string | null | undefined): string {
  if (!value) return ''
  return metaMap[value] ?? value
}

export function ImprovedPanel({
  result, loading, error,
  editableTC, onEditableChange,
  draftResult, draftError, draftLoading,
  onCopy, onDownload, onCreateDraft,
  liveJson,
}: Props) {
  const isEmpty = !result && !loading && !error

  return (
    <div className={`panel flex flex-col ${result ? 'panel-active' : ''}`}>
      <div className="panel-header">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-300 ${
          result ? 'bg-ok' : loading ? 'bg-accent animate-pulse' : 'bg-tx-dim'
        }`} />
        <span className="text-sm font-semibold text-tx-primary flex-1">Улучшенный кейс</span>
        {result?.display_duration && (
          <span className="text-xs font-mono text-tx-muted bg-bg-surface border border-line px-2 py-0.5 rounded-md">
            {result.display_duration}
          </span>
        )}
      </div>

      <div className="panel-body flex flex-col gap-4">
        {loading && !result && <ImprovedSkeleton />}
        {loading && !!result && (
          <div className="text-xs text-tx-muted font-mono bg-bg-surface border border-line rounded-lg px-3 py-2 animate-fade-in">
            Обновляю улучшенный кейс…
          </div>
        )}
        {error && !loading && <ErrorBlock msg={error} />}
        {isEmpty && !loading && !error && <EmptyState />}
        {result && editableTC && (
          <ImprovedContent
            result={result}
            editableTC={editableTC}
            onEditableChange={onEditableChange}
            liveJson={liveJson}
            draftResult={draftResult}
            draftError={draftError}
            draftLoading={draftLoading}
            onCopy={onCopy}
            onDownload={onDownload}
            onCreateDraft={onCreateDraft}
          />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center animate-fade-in">
      <div className="w-12 h-12 rounded-xl bg-bg-surface border border-line flex items-center justify-center mb-1">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M7 10l2.5 2.5L13 7" stroke="#BFC6D4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 4h10a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="#BFC6D4" strokeWidth="1.5" />
        </svg>
      </div>
      <p className="text-sm font-medium text-tx-secondary">Улучшенный тест-кейс</p>
      <p className="text-xs text-tx-muted max-w-[180px] leading-relaxed">
        Загрузите кейс и нажмите «Улучшить» — результат появится здесь
      </p>
    </div>
  )
}

function ErrorBlock({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2.5 p-3.5 bg-bad/5 border border-bad/20 rounded-lg text-xs text-bad font-mono animate-slide-up leading-relaxed">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 mt-0.5">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 4.5v3M7 9.5v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="whitespace-pre-line">{normalizeMultiline(msg)}</span>
    </div>
  )
}

function ImprovedSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="skeleton h-10 w-full rounded-lg" />
      <div className="skeleton h-7 w-2/3 rounded-md" />
      <div className="flex gap-2">
        <div className="skeleton h-5 w-14 rounded-full" />
        <div className="skeleton h-5 w-20 rounded-full" />
        <div className="skeleton h-5 w-16 rounded-full" />
      </div>
      <div className="skeleton h-3.5 w-1/3 rounded" />
      <div className="flex flex-col gap-2">
        <div className="skeleton h-3.5 w-full rounded" />
        <div className="skeleton h-3.5 w-5/6 rounded" />
      </div>
      <div className="skeleton h-3 w-12 rounded mt-2" />
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="flex gap-3 items-start py-2 border-b border-line/40 last:border-b-0">
          <div className="skeleton h-4 w-4 rounded flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1.5 flex-1">
            <div className={index % 2 === 0 ? 'skeleton h-3.5 rounded w-full' : 'skeleton h-3.5 rounded w-4/5'} />
            {index % 3 !== 2 && <div className="skeleton h-3 w-2/3 rounded" />}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-2 mt-3">
        <div className="skeleton h-24 w-full rounded-xl" />
        <div className="skeleton h-40 w-full rounded-xl" />
      </div>
    </div>
  )
}

function ImprovedContent({
  result, editableTC, onEditableChange, liveJson,
  draftResult, draftError, draftLoading,
  onCopy, onDownload, onCreateDraft,
}: {
  result: ImproveResult
  editableTC: TestCase
  onEditableChange: (tc: TestCase) => void
  liveJson: string
  draftResult: DraftResult | null
  draftError: string | null
  draftLoading: boolean
  onCopy: () => void
  onDownload: () => void
  onCreateDraft: () => void
}) {
  const updateTC = useCallback(
    (patch: Partial<TestCase>) => onEditableChange({ ...editableTC, ...patch }),
    [editableTC, onEditableChange],
  )

  const [diffOpen, setDiffOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

  const validationWarnings = result.validation_warnings ?? []
  const warnings = result.warnings ?? []
  const manualNotes = result.manual_notes ?? []
  const improvementNotes = result.improvement_notes ?? []
  const resolutions = result.issue_resolutions ?? []
  const hasResolutions = resolutions.length > 0
  const resolvedCount = resolutions.filter((resolution) => resolution.status === 'resolved').length
  const unresolvedCount = resolutions.filter((resolution) => resolution.status !== 'resolved').length
  const hasUnresolved = unresolvedCount > 0 || manualNotes.length > 0
  const hasExtraInfo = hasResolutions || improvementNotes.length > 0 || manualNotes.length > 0 || validationWarnings.length > 0 || warnings.length > 0

  return (
    <div className="flex flex-col gap-5 animate-slide-up">
      <div className="flex flex-col gap-2 p-3 bg-bg-surface border border-line rounded-lg">
        <div className="text-2xs font-mono uppercase tracking-wider text-tx-dim">
          Действия с JSON улучшенного кейса
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary text-xs" onClick={onCopy}>
            Копировать JSON
          </button>
          <button className="btn btn-secondary text-xs" onClick={onDownload}>
            Скачать JSON
          </button>
          <div className="flex flex-col items-end gap-1.5 ml-auto">
            {hasUnresolved && (
              <p className="text-xs text-warn flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
                  <path d="M6 1L11 10H1L6 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M6 5v2.5M6 9v.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                {unresolvedCount > 0 ? `${unresolvedCount} замечания требуют ручной правки` : 'Есть пункты для ручной правки'}
              </p>
            )}
            <button
              className="btn btn-primary text-sm"
              onClick={onCreateDraft}
              disabled={draftLoading}
            >
              {draftLoading ? <Spinner /> : null}
              {draftLoading ? 'Создание…' : 'Создать черновик в TestIT'}
            </button>
          </div>
        </div>
      </div>

      {draftError && (
        <div className="text-xs text-bad font-mono bg-bad/5 border border-bad/20 rounded-lg px-3 py-2 animate-slide-up whitespace-pre-line">
          {normalizeMultiline(draftError)}
        </div>
      )}

      {draftResult && (
        <div className="flex flex-col gap-1.5 text-xs bg-ok/10 border border-ok/35 border-l-4 border-l-ok rounded-lg px-3 py-2.5 shadow-sm ring-1 ring-ok/20 animate-slide-up">
          <div className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 text-ok">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-ok font-semibold">Черновик создан</span>
            <span className="font-mono text-tx-primary ml-auto">
              {draftResult.global_id ? `#${draftResult.global_id}` : draftResult.work_item_id}
            </span>
          </div>
          <p className="text-tx-secondary truncate">{draftResult.title}</p>
          {draftResult.testit_url && (
            <a href={draftResult.testit_url} target="_blank" rel="noopener noreferrer" className="text-ok font-medium underline underline-offset-2 hover:text-emerald-800 transition-colors">
              Открыть в TestIT →
            </a>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 bg-accent-dim rounded-lg border border-accent/15 text-xs text-accent font-medium">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M9.5 2L11 3.5L4 10.5H2.5V9L9.5 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Поля редактируются — JSON обновляется автоматически
      </div>

      <TestCaseView tc={editableTC} updateTC={updateTC} />

      {hasExtraInfo && (
        <div className="border border-line rounded-xl bg-bg-surface p-4 flex flex-col gap-4">
          {hasResolutions && (
            <div>
              <div className="section-label">Результат исправлений</div>
              <div className="flex flex-col">
                {resolutions.map((resolution, index) => (
                  <ResolutionRow key={index} resolution={resolution} />
                ))}
              </div>
            </div>
          )}

          {improvementNotes.length > 0 && (
            <div>
              <div className="section-label">Автоматические улучшения</div>
              {improvementNotes.map((note, index) => (
                <div key={index} className="warn-item-ok text-xs"><span className="text-ok">●</span><span className="whitespace-pre-line">{normalizeMultiline(note)}</span></div>
              ))}
            </div>
          )}

          {manualNotes.length > 0 && (
            <div>
              <div className="section-label">Требует доработки</div>
              {manualNotes.map((note, index) => (
                <div key={index} className="warn-item-error text-xs"><span className="text-bad">●</span><span className="whitespace-pre-line">{normalizeMultiline(note)}</span></div>
              ))}
            </div>
          )}

          {validationWarnings.map((warning, index) => (
            <div key={`validation-${index}`} className="warn-item text-xs"><span>⚠</span><span className="whitespace-pre-line">{normalizeMultiline(warning)}</span></div>
          ))}

          {warnings.map((warning, index) => (
            <div key={`warning-${index}`} className="warn-item text-xs"><span>⚠</span><span className="whitespace-pre-line">{normalizeMultiline(warning)}</span></div>
          ))}
        </div>
      )}

      {result.diff && (
        <div className="border border-line rounded-xl overflow-hidden">
          <button
            className={`flex items-center gap-2 px-3 py-2.5 text-xs bg-bg-surface w-full text-left ${diffOpen ? 'border-b border-line' : ''}`}
            onClick={() => setDiffOpen((v) => !v)}
          >
            <span className="section-label mb-0 flex-1">История изменений</span>
            {result.diff.changes?.length ? (
              <span className="font-mono text-tx-dim text-2xs bg-bg-hover px-1.5 py-0.5 rounded">{result.diff.changes.length}</span>
            ) : null}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
              className={`text-tx-dim transition-transform duration-200 ${diffOpen ? 'rotate-180' : ''}`}>
              <path d="M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {diffOpen && <ChangeHistory diff={result.diff} />}
        </div>
      )}

      <div className="border border-line rounded-xl overflow-hidden">
        <button
            className={`flex items-center gap-2 px-3 py-2.5 text-xs bg-bg-surface w-full text-left ${jsonOpen ? 'border-b border-line' : ''}`}
            onClick={() => setJsonOpen((v) => !v)}
          >
            <span className="section-label mb-0 flex-1">TestIT JSON</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className={`text-tx-dim transition-transform duration-200 ${jsonOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              <path d="M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        {jsonOpen && (
          <pre
            className="text-xs font-mono text-tx-code bg-bg-surface px-3 py-2.5 overflow-auto"
            style={{ maxHeight: '240px', margin: 0, lineHeight: '1.6', scrollbarWidth: 'thin', scrollbarColor: '#2A3048 transparent' }}
          >
            {liveJson}
          </pre>
        )}
      </div>
    </div>
  )
}

function metaBadgeClass(value: string): string {
  const normalized = value.trim().toLowerCase()

  if (['критичный', 'высокий', 'high', 'highest'].includes(normalized)) {
    return 'text-sev-high bg-sev-high-bg border-sev-high-border'
  }
  if (['средний', 'medium', 'med'].includes(normalized)) {
    return 'text-sev-med bg-sev-med-bg border-sev-med-border'
  }
  if (['низкий', 'готов', 'low', 'ready'].includes(normalized)) {
    return 'text-sev-low bg-sev-low-bg border-sev-low-border'
  }
  if (['требует доработки', 'needswork', 'needs_work'].includes(normalized)) {
    return 'text-warn bg-warn/10 border-warn/30'
  }

  return 'text-tx-secondary bg-bg-surface border-line'
}

const PRIORITY_OPTIONS = [
  { value: 'Highest', label: 'Критичный' },
  { value: 'High', label: 'Высокий' },
  { value: 'Medium', label: 'Средний' },
  { value: 'Low', label: 'Низкий' },
]

function PrioritySelect({ value, onChange }: { value: string | null | undefined; onChange: (v: string) => void }) {
  if (!value) return null
  const colorClass = metaBadgeClass(localizeMeta(value))
  return (
    <div className="relative inline-flex items-center">
      <select
        className={`inline-flex items-center pl-2 pr-6 py-0.5 rounded border text-xs font-mono bg-transparent cursor-pointer appearance-none ${colorClass}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Изменить приоритет"
      >
        {PRIORITY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="absolute right-1.5 pointer-events-none opacity-60">
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

const STATUS_OPTIONS = [
  { value: 'Ready', label: 'Готов' },
  { value: 'NotReady', label: 'Не готов' },
  { value: 'NeedsWork', label: 'Требует доработки' },
]

function StatusSelect({ value, onChange }: { value: string | null | undefined; onChange: (v: string) => void }) {
  if (!value) return null
  const colorClass = metaBadgeClass(localizeMeta(value))
  return (
    <div className="relative inline-flex items-center">
      <select
        className={`inline-flex items-center pl-2 pr-6 py-0.5 rounded border text-xs font-mono bg-transparent cursor-pointer appearance-none ${colorClass}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Изменить статус"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="absolute right-1.5 pointer-events-none opacity-60">
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function EditableTags({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [inputVal, setInputVal] = useState('')

  const removeTag = (index: number) => onChange(tags.filter((_, i) => i !== index))

  const addTag = (raw: string) => {
    const trimmed = raw.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed])
    setInputVal('')
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center min-h-[24px]">
      {tags.map((tag, i) => (
        <span key={i} className="tag-pill flex items-center gap-1 pr-1">
          {tag}
          <button
            className="ml-0.5 text-tx-dim hover:text-bad transition-colors leading-none"
            onClick={() => removeTag(i)}
            title="Удалить тег"
            type="button"
          >×</button>
        </span>
      ))}
      <input
        className="text-xs bg-transparent border-b border-dashed border-line outline-none px-1 min-w-[52px] max-w-[120px] text-tx-muted placeholder:text-tx-dim"
        placeholder="+ тег"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(inputVal) }
          if (e.key === 'Backspace' && !inputVal && tags.length > 0) removeTag(tags.length - 1)
        }}
        onBlur={() => { if (inputVal.trim()) addTag(inputVal) }}
        spellCheck={false}
      />
    </div>
  )
}

function TestCaseView({ tc, updateTC }: { tc: TestCase; updateTC: (p: Partial<TestCase>) => void }) {
  return (
    <div className="flex flex-col gap-3.5">
      {tc.title != null && (
        <div
          className="editable text-lg font-bold text-tx-primary leading-snug"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(e) => updateTC({ title: e.currentTarget.textContent?.trim() ?? '' })}
        >
          {tc.title}
        </div>
      )}

      <EditableTags tags={tc.tags ?? []} onChange={(tags) => updateTC({ tags })} />

      <div className="flex items-center gap-3 flex-wrap text-xs font-mono">
        <span className="flex items-center gap-2 text-tx-muted">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="flex-shrink-0">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5.5 3v2.5L7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span
            className="editable min-w-[32px] px-1"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            title="Редактировать время"
            onBlur={(e) => updateTC({ display_duration: e.currentTarget.textContent?.trim() || undefined })}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
          >
            {tc.display_duration ?? tc.duration ?? '—'}
          </span>
        </span>
        <PrioritySelect value={tc.priority} onChange={(p) => updateTC({ priority: p })} />
        <StatusSelect value={tc.status} onChange={(s) => updateTC({ status: s })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="section-label">Описание</div>
        <div
          className="w-full rounded-lg border border-line bg-bg-surface px-3 py-2 text-sm text-tx-primary leading-relaxed whitespace-pre-wrap min-h-[52px] outline-none transition-all duration-150 hover:border-line-bright focus:border-accent focus:ring-2 focus:ring-accent/20"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(e) => updateTC({ description: e.currentTarget.textContent?.trim() ?? '' })}
        >
          {tc.description ?? ''}
        </div>
      </div>

      {tc.preconditions?.length ? (
        <div>
          <div className="section-label">Предусловия</div>
          <EditableStepList steps={tc.preconditions} onStepsChange={(steps) => updateTC({ preconditions: steps })} />
        </div>
      ) : null}

      {tc.steps?.length ? (
        <div>
          <div className="section-label">Шаги</div>
          <EditableStepList steps={tc.steps} onStepsChange={(steps) => updateTC({ steps })} />
        </div>
      ) : null}

      {tc.postconditions?.length ? (
        <div>
          <div className="section-label">Постусловия</div>
          <EditableStepList steps={tc.postconditions} onStepsChange={(steps) => updateTC({ postconditions: steps })} />
        </div>
      ) : null}

      {tc.attributes && Object.keys(tc.attributes).length > 0 && (
        <div className="text-xs text-tx-muted px-3 py-2 bg-bg-surface border border-line rounded-lg flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0 text-tx-dim">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 5.5v3M6 4v.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span>Атрибуты TestIT ({Object.keys(tc.attributes).length} шт.) сохранены и будут переданы при создании черновика</span>
        </div>
      )}
    </div>
  )
}

function EditableStepList({ steps, onStepsChange }: { steps: Step[]; onStepsChange: (s: Step[]) => void }) {
  const updateStep = (index: number, field: keyof Step, value: string) => {
    onStepsChange(steps.map((step, stepIndex) => stepIndex === index ? { ...step, [field]: value || null } : step))
  }

  return (
    <ol className="flex flex-col border border-line rounded-lg overflow-hidden">
      {steps.map((step, index) => (
        <li key={index} className="step-item px-3 bg-bg-panel last:border-b-0">
          <span className="step-num">{index + 1}.</span>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0 py-0.5">
            <div
              className="editable text-sm text-tx-secondary leading-snug"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={(e) => updateStep(index, 'action', e.currentTarget.textContent?.trim() ?? '')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault() }}
            >
              {step.action}
            </div>
            {step.expected != null && (
              <div className="flex items-start gap-1">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0 mt-0.5 text-ok">
                  <path d="M2.5 6l3 3 4-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div
                  className="editable text-xs text-ok/80 leading-snug flex-1"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={(e) => updateStep(index, 'expected', e.currentTarget.textContent?.trim() ?? '')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault() }}
                >
                  {step.expected}
                </div>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

const resolutionConfig: Record<ResolutionStatus, { label: string; dot: string; card: string; text: string }> = {
  resolved:      { label: 'исправлено',        dot: 'bg-ok',     card: 'border-ok/20 bg-ok/5',      text: 'text-ok' },
  manual_needed: { label: 'требует доработки', dot: 'bg-warn',   card: 'border-warn/20 bg-warn/5',  text: 'text-warn' },
  skipped:       { label: 'пропущено',         dot: 'bg-tx-dim', card: 'border-line bg-bg-surface', text: 'text-tx-muted' },
}

function ResolutionRow({ resolution }: { resolution: IssueResolution }) {
  const cfg = resolutionConfig[resolution.status] ?? resolutionConfig.skipped
  const detail = resolution.action_taken ?? resolution.reason ?? ''

  return (
    <div className={`rounded-lg border p-2.5 mb-2 last:mb-0 ${cfg.card}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className={`text-2xs font-mono font-semibold uppercase tracking-wide ${cfg.text}`}>
          {cfg.label}
        </span>
      </div>
      <p className="text-xs text-tx-primary font-medium leading-snug mb-1 whitespace-pre-line">{normalizeMultiline(resolution.issue_title)}</p>
      {detail && <p className="text-xs text-tx-muted leading-relaxed whitespace-pre-line">{normalizeMultiline(detail)}</p>}
    </div>
  )
}

const FIELD_NAMES: Record<string, string> = {
  title: 'Заголовок',
  description: 'Описание',
  preconditions: 'Предусловия',
  steps: 'Шаги',
  postconditions: 'Постусловия',
  tags: 'Теги',
  priority: 'Приоритет',
  status: 'Статус',
  duration: 'Длительность',
  attributes: 'Атрибуты',
}

function ChangeHistory({ diff }: { diff: Diff }) {
  if (!diff.changes?.length) {
    return (
      <div className="px-4 py-4 text-xs text-tx-muted flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 4v3M6 8.5v.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        Поля не изменились
      </div>
    )
  }

  const typeConfig = {
    added:   { dot: 'bg-ok',     label: 'добавлено',  textClass: 'text-ok' },
    changed: { dot: 'bg-accent', label: 'изменено',   textClass: 'text-accent' },
    removed: { dot: 'bg-bad',    label: 'удалено',    textClass: 'text-bad' },
  }

  return (
    <div className="px-3 py-3 bg-bg-surface flex flex-col gap-0">
      {diff.changes.map((change, index) => {
        const cfg = typeConfig[change.type as keyof typeof typeConfig] ?? typeConfig.changed
        const fieldLabel = FIELD_NAMES[change.field] ?? change.field
        return (
          <div key={index} className="flex items-start gap-3 py-2.5 border-b border-line/30 last:border-b-0">
            {/* Timeline dot + line */}
            <div className="flex flex-col items-center flex-shrink-0 mt-1">
              <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-tx-primary">{fieldLabel}</span>
                <span className={`text-[10px] font-mono ${cfg.textClass} opacity-70`}>{cfg.label}</span>
              </div>
              {change.before && (
                <div className="text-xs text-tx-dim line-through leading-relaxed truncate" title={normalizeMultiline(change.before)}>
                  {normalizeMultiline(change.before).slice(0, 120)}{change.before.length > 120 ? '…' : ''}
                </div>
              )}
              {change.after && (
                <div className="text-xs text-tx-secondary leading-relaxed" style={{ wordBreak: 'break-word' }}>
                  {normalizeMultiline(change.after).slice(0, 200)}{change.after.length > 200 ? '…' : ''}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="24 12" opacity="0.8" />
    </svg>
  )
}

export type { Props as ImprovedPanelProps }
