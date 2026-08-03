import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, EyeOff, FilePlus, Loader2, X,
  ExternalLink, Link2, Paperclip, RotateCcw, Sparkles, Wand2, Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { api, humanizeDraftError } from '../api'
import { ActionBanner } from './ActionBanner'
import { ModeButton } from './ModeButton'
import { SectionHeader } from './SectionHeader'
import { ProgressBar } from './ProgressBar'
import type {
  ActionNotification, AnalyzeResult, ApplyResult, DraftResult, FetchResult, ImproveResult,
  IssueResolution, ParameterTable, ReviewConfig, ReviewIssue, ReviewRuleId, Step, TestCase, WorkItemLink,
} from '../types'

interface Props {
  fetchResult: FetchResult
  reviewConfig: ReviewConfig
  selectedPreset: string
  enabledRules: ReviewRuleId[]
  onApply: (preset: string, rules: ReviewRuleId[]) => void
  onBack: () => void
}

// Marker warning from _FALLBACK_REVIEW (llm_client.py) — analyze returned a fake
// "issue" describing a tooling failure, not a real test case defect. Improving it
// would ask the LLM to "fix" a meta-error instead of the actual test case.
const LLM_UNAVAILABLE_WARNING = 'LLM is unavailable, fallback response returned'

function priorityLabels(t: TFunction): Record<string, string> {
  const critical = t('workbench.priority.critical')
  const highest = t('workbench.priority.highest')
  const high = t('workbench.priority.high')
  const medium = t('workbench.priority.medium')
  const low = t('workbench.priority.low')
  return {
    Critical: critical, Highest: highest, High: high, Medium: medium, Low: low,
    critical, highest, high, medium, low,
  }
}

// TestIT returns status values in English; map to a localized label and badge class
function statusLabels(t: TFunction): Record<string, string> {
  return {
    Ready: t('workbench.status.ready'),
    NotReady: t('workbench.status.notReady'),
    Draft: t('workbench.status.draft'),
    NeedsWork: t('workbench.status.needsWork'),
    Obsolete: t('workbench.status.obsolete'),
    InProgress: t('workbench.status.inProgress'),
  }
}
const STATUS_PILL: Record<string, string> = {
  Ready: 'pill-ok',
  NotReady: 'pill-err',
  Draft: 'pill-neutral',
  NeedsWork: 'pill-warn',
  Obsolete: 'pill-neutral',
  InProgress: 'pill-warn',
}

// Statuses the edit form lets you pick. Any other status a test case already
// has (Draft/Obsolete/InProgress from TestIT) gets an extra option injected so
// it stays selected and isn't silently overwritten on save.
const EDITABLE_STATUSES = new Set(['Ready', 'NotReady', 'NeedsWork'])

function fieldLabels(t: TFunction): Record<string, string> {
  return {
    title: t('workbench.editable.titleLabel'),
    description: t('workbench.testCase.descriptionLabel'),
    preconditions: t('workbench.testCase.preconditionLabel'),
    postconditions: t('workbench.testCase.postconditionLabel'),
    tags: t('workbench.testCase.tagsLabel'),
    priority: t('workbench.editable.priorityLabel'),
    status: t('workbench.editable.statusLabel'),
    duration: t('workbench.editable.durationLabel'),
    expected: t('workbench.steps.colExpected'),
    action: t('workbench.steps.colAction'),
    test_data: t('workbench.steps.colTestData'),
  }
}

// Highlight %param_name substitutions in action text
function renderWithParams(text: string) {
  const parts = text.split(/(%[a-zA-Z_][a-zA-Z0-9_]*)/g)
  if (parts.length <= 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        /^%[a-zA-Z_][a-zA-Z0-9_]*$/.test(part)
          ? <code key={i} className="param-ref">{part}</code>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

function StepsTable({
  steps,
  warnMissingTestData = false,
}: {
  steps: Step[]
  warnMissingTestData?: boolean
}) {
  const { t } = useTranslation()
  const showTestData = warnMissingTestData || steps.some(s => !!s.test_data)
  const showComments = steps.some(s => !!s.comments)
  const cols = [
    '28px', '1fr', '1fr',
    ...(showTestData ? ['1fr'] : []),
    ...(showComments ? ['minmax(80px,0.5fr)'] : []),
  ].join(' ')

  return (
    <div className="steps-tbl">
      <div className="steps-head" style={{ gridTemplateColumns: cols }}>
        <div className="steps-th steps-th-num">#</div>
        <div className="steps-th">{t('workbench.steps.colAction')}</div>
        <div className="steps-th">{t('workbench.steps.colExpected')}</div>
        {showTestData && <div className="steps-th">{t('workbench.steps.colTestData')}</div>}
        {showComments && <div className="steps-th">{t('workbench.steps.colComments')}</div>}
      </div>
      {steps.map((step, i) => (
        <div key={i} className="steps-row" style={{ gridTemplateColumns: cols }}>
          <div className="steps-num-cell">{i + 1}</div>
          <div className="steps-cell steps-action">{renderWithParams(step.action)}</div>
          <div className="steps-cell steps-exp">
            {step.expected || null}
          </div>
          {showTestData && (
            <div className="steps-cell steps-td-col">
              {step.test_data
                ? <span className="steps-td-mono">{step.test_data}</span>
                : null
              }
            </div>
          )}
          {showComments && (
            <div className="steps-cell steps-cm-col">
              {step.comments ?? null}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function StepBlock({ label, steps, warnMissingTestData }: {
  label: string; steps: Step[] | undefined | null; warnMissingTestData?: boolean
}) {
  if (!steps?.length) return null
  return (
    <div>
      <span className="case-sec-label">{label}</span>
      <StepsTable steps={steps} warnMissingTestData={warnMissingTestData} />
    </div>
  )
}


function ParamTableView({ table }: { table: ParameterTable }) {
  if (!table.names.length || !table.rows.length) return null
  const cols = `repeat(${table.names.length}, 1fr)`
  return (
    <div className="param-tbl">
      <div className="param-head" style={{ gridTemplateColumns: cols }}>
        {table.names.map(name => <div key={name} className="param-th">{name}</div>)}
      </div>
      {table.rows.map((row, ri) => (
        <div key={ri} className="param-row" style={{ gridTemplateColumns: cols }}>
          {row.map((cell, ci) => <div key={ci} className="param-cell">{cell}</div>)}
        </div>
      ))}
    </div>
  )
}

// Link type → localized label
function linkTypeLabels(t: TFunction): Record<string, string> {
  return {
    Issue: t('workbench.linkType.issue'),
    Defect: t('workbench.linkType.defect'),
    Requirement: t('workbench.linkType.requirement'),
    BlockedBy: t('workbench.linkType.blockedBy'),
    Related: t('workbench.linkType.related'),
    Clones: t('workbench.linkType.clones'),
    Repository: t('workbench.linkType.repository'),
  }
}

// Derive short readable label from a link (strip URL if title == url)
function linkLabel(link: WorkItemLink): string {
  const t = link.title?.trim()
  const u = link.url?.trim() ?? ''
  if (!t || t === u) {
    try {
      const parts = new URL(u).pathname.split('/').filter(Boolean)
      return parts[parts.length - 1] ?? u
    } catch {
      return u
    }
  }
  return t
}

// Tags that trigger warning-style chip
const WARN_TAGS = new Set(['needs-review', 'needs_review'])
const SOURCE_TAG_RE = /^source-(\d+)$/

// Service footer markers that indicate unprocessed LLM response
const SERVICE_FOOTER_MARKERS = [
  'Generated by qa-ai-tool',
  'Source work item',
  'Needs QA review',
]

function PartialFieldWarning() {
  const { t } = useTranslation()
  return (
    <span className="partial-field-missing">
      <AlertTriangle size={11} />
      {t('workbench.testCase.notProcessed')}
    </span>
  )
}

function TestCaseView({ tc, partialFields }: { tc: TestCase; partialFields?: Set<string> }) {
  const { t } = useTranslation()
  const priority = tc.priority
  const priorityLabel = priority ? (priorityLabels(t)[priority] ?? priority) : null
  const priorityKey = (priority ?? '').toLowerCase()
  const statusLabel = tc.status ? (statusLabels(t)[tc.status] ?? tc.status) : null
  const priorityDotClass =
    priorityKey === 'critical' || priorityKey === 'highest' || priorityKey === 'high' ? 'pdot-high' :
    priorityKey === 'medium' ? 'pdot-medium' :
    priorityKey === 'low' ? 'pdot-low' : 'pdot-neutral'
  const statusPill = tc.status ? (STATUS_PILL[tc.status] ?? 'pill-neutral') : 'pill-neutral'

  // TODO: attachments_count from tc.attributes once TestIT mapper populates it
  const attachmentsCount = Number(tc.attributes?.['attachments_count'] ?? 0)

  // Metadata grid — always 4 cards; '—' when absent
  // TODO: globalId / versionNumber from tc.attributes once TestIT mapper populates them
  const dur = tc.display_duration ?? (tc.duration != null ? String(tc.duration) : null)
  const globalId = tc.attributes?.['globalId']
  const versionNumber = tc.attributes?.['versionNumber']
  const metaItems: Array<{ label: string; value: string }> = [
    { label: t('workbench.testCase.metaSection'), value: tc.section_name ?? '—' },
    { label: t('workbench.testCase.metaDuration'), value: dur ?? '—' },
    { label: t('workbench.testCase.metaId'), value: globalId != null ? String(globalId) : '—' },
    { label: t('workbench.testCase.metaVersion'), value: versionNumber != null ? String(versionNumber) : '—' },
  ]
  // Optional: Author only when present in attributes
  const author = tc.attributes?.['Author'] ?? tc.attributes?.['Автор'] ?? tc.attributes?.['author'] ?? tc.attributes?.['createdBy']
  if (author != null) metaItems.push({ label: t('workbench.testCase.metaAuthor'), value: String(author) })
  const hasAnyMeta = metaItems.some(m => m.value !== '—')

  const hasPost = (tc.postconditions?.length ?? 0) > 0

  return (
    <>
      {/* Title + pills */}
      <div>
        <div className="case-tc-title">
          {tc.title?.trim() || (partialFields?.has('title') ? <PartialFieldWarning /> : '—')}
        </div>
        <div className="case-pills">
          {priorityLabel && (
            <span className="case-pill pill-priority">
              <span className={`priority-dot ${priorityDotClass}`} />
              {priorityLabel}
            </span>
          )}
          {statusLabel && <span className={`case-pill ${statusPill}`}>{statusLabel}</span>}
          <span className="case-pill pill-attachment">
            <Paperclip size={11} />
            {attachmentsCount}
          </span>
          <span className="case-pill pill-attachment">
            <Link2 size={11} />
            {tc.links?.length ?? 0}
          </span>
        </div>
      </div>

      {/* Metadata grid */}
      {hasAnyMeta && (
        <div>
          <span className="case-sec-label">{t('workbench.testCase.metadataLabel')}</span>
          <div className="meta-grid">
            {metaItems.map(item => (
              <div key={item.label} className="meta-card">
                <span className="meta-key">{item.label}</span>
                <span className={`meta-val${item.value === '—' ? ' meta-val-empty' : ''}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tags — always show; filter source-NNNN; separate service tags */}
      {(() => {
        const allTags = tc.tags ?? []
        const sourceMatch = allTags.map(tag => tag.match(SOURCE_TAG_RE)).find(Boolean)
        const sourceId = sourceMatch?.[1]
        const withoutSource = allTags.filter(tag => !SOURCE_TAG_RE.test(tag))
        const regularTags = withoutSource
        const hasAny = regularTags.length > 0

        return (
          <div>
            <span className="case-sec-label">{t('workbench.testCase.tagsLabel')}</span>
            {sourceId && (
              <div className="source-id-badge">
                {t('workbench.testCase.sourceCaseLabel')}<span style={{ color: 'var(--accent)' }}>#{sourceId}</span>
              </div>
            )}
            {hasAny ? (
              <div className="tag-chips">
                {regularTags.map(tag => (
                  <span
                    key={tag}
                    className={`tag-chip${WARN_TAGS.has(tag) ? ' tag-chip-warn' : ''}`}
                    title={WARN_TAGS.has(tag) ? t('workbench.testCase.tagFlaggedTitle') : undefined}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="case-text-box case-text-empty">{t('workbench.testCase.notSpecified')}</div>
            )}
          </div>
        )
      })()}

      {/* Linked issues / requirements — always show */}
      <div>
        <span className="case-sec-label">{t('workbench.testCase.relatedIssuesLabel')}</span>
        {(tc.links?.length ?? 0) > 0 ? (
          <div className="links-list">
            {tc.links!.map((link, i) => (
              <a
                key={i}
                className="link-row"
                href={link.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={`link-type-badge link-type-${(link.type ?? 'default').toLowerCase()}`}>
                  {linkTypeLabels(t)[link.type ?? ''] ?? link.type ?? t('workbench.testCase.linkFallback')}
                </span>
                <span className="link-label">{linkLabel(link)}</span>
                <ExternalLink size={11} className="link-ext-icon" />
              </a>
            ))}
          </div>
        ) : (
          <div className="case-text-box case-text-empty">{t('workbench.testCase.notSpecified')}</div>
        )}
      </div>

      {/* Description — always show */}
      <div>
        <span className="case-sec-label">{t('workbench.testCase.descriptionLabel')}</span>
        {tc.description?.trim()
          ? <div className="case-text-box" style={{ whiteSpace: 'pre-line' }}>{tc.description.trim()}</div>
          : partialFields?.has('description')
            ? <div className="case-text-box case-text-empty"><PartialFieldWarning /></div>
            : <div className="case-text-box case-text-empty">{t('workbench.testCase.notSpecified')}</div>
        }
      </div>

      {/* Attachments — show list when any exist */}
      {(tc.attachments?.length ?? 0) > 0 && (
        <div>
          <span className="case-sec-label">{t('workbench.testCase.attachmentsLabel')}</span>
          <div className="links-list">
            {tc.attachments!.map((att, i) => (
              att.url
                ? <a key={i} className="link-row" href={att.url} target="_blank" rel="noopener noreferrer">
                    <span className="link-type-badge link-type-default">{att.type ?? t('workbench.testCase.attachmentFileFallback')}</span>
                    <span className="link-label">{att.name ?? att.file_id ?? att.url}</span>
                    <ExternalLink size={11} className="link-ext-icon" />
                  </a>
                : <div key={i} className="link-row" style={{ cursor: 'default' }}>
                    <span className="link-type-badge link-type-default">{att.type ?? t('workbench.testCase.attachmentFileFallback')}</span>
                    <span className="link-label">{att.name ?? att.file_id ?? '—'}</span>
                  </div>
            ))}
          </div>
        </div>
      )}

      {/* Product versions */}
      {(tc.product_versions?.length ?? 0) > 0 && (
        <div>
          <span className="case-sec-label">{t('workbench.testCase.productVersionsLabel')}</span>
          <div className="tag-chips">
            {tc.product_versions!.map((v, i) => (
              <span key={i} className="tag-chip" style={{ fontFamily: 'monospace' }}>{v}</span>
            ))}
          </div>
        </div>
      )}

      {/* Preconditions */}
      <StepBlock label={t('workbench.testCase.preconditionLabel')} steps={tc.preconditions} />

      {/* Steps — always show; warn on missing test_data */}
      <div>
        <span className="case-sec-label">
          {t('workbench.testCase.stepsLabel')}
        </span>
        {(tc.steps?.length ?? 0) > 0 ? (
          <StepsTable steps={tc.steps!} warnMissingTestData />
        ) : partialFields?.has('steps') ? (
          <div className="case-text-box case-text-empty"><PartialFieldWarning /></div>
        ) : (
          <div className="case-text-box case-text-empty">{t('workbench.testCase.notSpecified')}</div>
        )}
      </div>

      {/* Postconditions — always shown */}
      <div>
        <span className="case-sec-label">{t('workbench.testCase.postconditionLabel')}</span>
        {hasPost
          ? <StepsTable steps={tc.postconditions!} />
          : <div className="case-text-box case-text-empty">{t('workbench.testCase.notSpecified')}</div>
        }
      </div>

      {/* Parameters table — shown only when data present */}
      {tc.parameter_table && tc.parameter_table.names.length > 0 && (
        <div>
          <span className="case-sec-label">{t('workbench.testCase.parametersLabel')}</span>
          <ParamTableView table={tc.parameter_table} />
        </div>
      )}
    </>
  )
}

// ── Editable TestCase components ───────────────────────────────────────────

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function AutoTextarea({ className, placeholder, value, onChange }: {
  className: string; placeholder: string; value: string; onChange: (v: string) => void
}) {
  return (
    <textarea
      className={className}
      placeholder={placeholder}
      value={value}
      rows={1}
      onChange={e => { autoResize(e.target); onChange(e.target.value) }}
      onFocus={e => autoResize(e.target)}
      ref={el => { if (el) autoResize(el) }}
    />
  )
}

function EditableStepsTable({ steps, showComments, onUpdate, onRemove, onAdd }: {
  steps: Step[]
  showComments: boolean
  onUpdate: (i: number, key: keyof Step, value: string) => void
  onRemove: (i: number) => void
  onAdd: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="tc-edit-steps">
      {steps.map((step, i) => (
        <div key={i} className="tc-edit-step-row">
          <div className="tc-edit-step-num">{i + 1}</div>
          <div className="tc-edit-step-fields">
            <AutoTextarea
              className="tc-edit-cell"
              placeholder={t('workbench.steps.colAction')}
              value={step.action ?? ''}
              onChange={v => onUpdate(i, 'action', v)}
            />
            <AutoTextarea
              className="tc-edit-cell tc-edit-cell-dim"
              placeholder={t('workbench.steps.colExpected')}
              value={step.expected ?? ''}
              onChange={v => onUpdate(i, 'expected', v)}
            />
            <AutoTextarea
              className="tc-edit-cell"
              placeholder={t('workbench.steps.colTestData')}
              value={step.test_data ?? ''}
              onChange={v => onUpdate(i, 'test_data', v)}
            />
            {showComments && (
              <AutoTextarea
                className="tc-edit-cell tc-edit-cell-dim"
                placeholder={t('workbench.steps.commentPlaceholder')}
                value={step.comments ?? ''}
                onChange={v => onUpdate(i, 'comments', v)}
              />
            )}
          </div>
          <button type="button" className="tc-edit-step-del" title={t('workbench.steps.removeStepTitle')} onClick={() => onRemove(i)}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="tc-edit-add-step" onClick={onAdd}>
        {t('workbench.steps.addStep')}
      </button>
    </div>
  )
}

function EditableTestCaseView({ tc, onChange }: { tc: TestCase; onChange: (updated: TestCase) => void }) {
  const { t } = useTranslation()
  function updateStep(field: 'steps' | 'preconditions' | 'postconditions', index: number, key: keyof Step, value: string) {
    const steps = [...(tc[field] ?? [])]
    steps[index] = { ...steps[index], [key]: value || null }
    onChange({ ...tc, [field]: steps })
  }
  function removeStep(field: 'steps' | 'preconditions' | 'postconditions', index: number) {
    const steps = [...(tc[field] ?? [])]
    steps.splice(index, 1)
    onChange({ ...tc, [field]: steps })
  }
  function addStep(field: 'steps' | 'preconditions' | 'postconditions') {
    const steps = [...(tc[field] ?? []), { action: '', expected: null, test_data: null, comments: null }]
    onChange({ ...tc, [field]: steps })
  }

  return (
    <div className="tc-editor">
      <div>
        <span className="case-sec-label">{t('workbench.editable.titleLabel')}</span>
        <input
          className="tc-edit-input"
          value={tc.title ?? ''}
          onChange={e => onChange({ ...tc, title: e.target.value })}
        />
      </div>
      <div className="tc-edit-row2">
        <div>
          <span className="case-sec-label">{t('workbench.editable.priorityLabel')}</span>
          <select
            className="tc-edit-input"
            value={tc.priority ?? ''}
            onChange={e => onChange({ ...tc, priority: e.target.value || null })}
          >
            <option value="">{t('workbench.editable.notSet')}</option>
            <option value="Critical">{t('workbench.priority.critical')}</option>
            <option value="Highest">{t('workbench.priority.highest')}</option>
            <option value="High">{t('workbench.priority.high')}</option>
            <option value="Medium">{t('workbench.priority.medium')}</option>
            <option value="Low">{t('workbench.priority.low')}</option>
          </select>
        </div>
        <div>
          <span className="case-sec-label">{t('workbench.editable.statusLabel')}</span>
          <select
            className="tc-edit-input"
            value={tc.status ?? ''}
            onChange={e => onChange({ ...tc, status: e.target.value || null })}
          >
            <option value="">{t('workbench.editable.notSet')}</option>
            <option value="Ready">{t('workbench.status.ready')}</option>
            <option value="NotReady">{t('workbench.status.notReady')}</option>
            <option value="NeedsWork">{t('workbench.status.needsWork')}</option>
            {tc.status && !EDITABLE_STATUSES.has(tc.status) && (
              <option value={tc.status}>{statusLabels(t)[tc.status] ?? tc.status}</option>
            )}
          </select>
        </div>
      </div>
      <div>
        <span className="case-sec-label">{t('workbench.testCase.tagsLabel')}</span>
        <div className="tc-edit-tags">
          {(tc.tags ?? []).map(tag => (
            <span key={tag} className="tc-edit-tag">
              {tag}
              <button
                type="button"
                className="tc-edit-tag-del"
                onClick={() => onChange({ ...tc, tags: (tc.tags ?? []).filter(existing => existing !== tag) })}
              >×</button>
            </span>
          ))}
          <input
            className="tc-edit-tag-input"
            placeholder={t('workbench.editable.tagPlaceholder')}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ',') && e.currentTarget.value.trim()) {
                e.preventDefault()
                const newTag = e.currentTarget.value.trim().replace(/,$/, '')
                if (!(tc.tags ?? []).includes(newTag)) {
                  onChange({ ...tc, tags: [...(tc.tags ?? []), newTag] })
                }
                e.currentTarget.value = ''
              }
            }}
          />
        </div>
      </div>
      <div>
        <span className="case-sec-label">{t('workbench.editable.durationLabel')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            className="tc-edit-input"
            type="number"
            min={1}
            style={{ width: 80 }}
            value={tc.duration != null && /^\d+$/.test(String(tc.duration))
              ? Math.round(parseInt(String(tc.duration), 10) / 60000)
              : ''}
            placeholder="—"
            onChange={e => {
              const mins = parseInt(e.target.value, 10)
              onChange({ ...tc, duration: isNaN(mins) || mins <= 0 ? null : String(mins * 60000) })
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--tx-dim)' }}>{t('workbench.editable.minutesSuffix')}</span>
        </div>
      </div>
      <div>
        <span className="case-sec-label">{t('workbench.testCase.descriptionLabel')}</span>
        <textarea
          className="tc-edit-textarea"
          value={tc.description ?? ''}
          rows={1}
          onChange={e => { autoResize(e.target); onChange({ ...tc, description: e.target.value || null }) }}
          onFocus={e => autoResize(e.target)}
          ref={el => { if (el) autoResize(el) }}
        />
      </div>
      <div>
        <span className="case-sec-label">{t('workbench.testCase.preconditionLabel')}</span>
        <EditableStepsTable
          steps={tc.preconditions ?? []}
          showComments={false}
          onUpdate={(i, k, v) => updateStep('preconditions', i, k, v)}
          onRemove={i => removeStep('preconditions', i)}
          onAdd={() => addStep('preconditions')}
        />
      </div>
      <div>
        <span className="case-sec-label">{t('workbench.testCase.stepsLabel')}</span>
        <EditableStepsTable
          steps={tc.steps ?? []}
          showComments
          onUpdate={(i, k, v) => updateStep('steps', i, k, v)}
          onRemove={i => removeStep('steps', i)}
          onAdd={() => addStep('steps')}
        />
      </div>
      <div>
        <span className="case-sec-label">{t('workbench.testCase.postconditionLabel')}</span>
        <EditableStepsTable
          steps={tc.postconditions ?? []}
          showComments={false}
          onUpdate={(i, k, v) => updateStep('postconditions', i, k, v)}
          onRemove={i => removeStep('postconditions', i)}
          onAdd={() => addStep('postconditions')}
        />
      </div>
    </div>
  )
}

const DIFF_SECTION_ORDER = ['steps', 'preconditions', 'postconditions', 'metadata'] as const
function diffSectionLabels(t: TFunction): Record<string, string> {
  return {
    steps: t('workbench.testCase.stepsLabel'),
    preconditions: t('workbench.diff.sectionPreconditions'),
    postconditions: t('workbench.diff.sectionPostconditions'),
    metadata: t('workbench.testCase.metadataLabel'),
  }
}

function diffSectionKey(field: string): string {
  if (field.startsWith('steps.')) return 'steps'
  if (field.startsWith('preconditions.')) return 'preconditions'
  if (field.startsWith('postconditions.')) return 'postconditions'
  return 'metadata'
}

function diffItemKey(field: string): string {
  const m = field.match(/^(steps|preconditions|postconditions)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}` : field
}

function diffItemLabel(t: TFunction, itemKey: string): string {
  const m = itemKey.match(/^(steps|preconditions|postconditions)\.(\d+)$/)
  if (m) {
    const n = parseInt(m[2]) + 1
    if (m[1] === 'steps') return t('workbench.diff.stepN', { n })
    if (m[1] === 'preconditions') return t('workbench.diff.preconditionN', { n })
    return t('workbench.diff.postconditionN', { n })
  }
  return fieldLabels(t)[itemKey] ?? itemKey
}

function diffSubLabel(t: TFunction, field: string): string {
  const m = field.match(/^(?:steps|preconditions|postconditions)\.\d+\.(.+)$/)
  const key = m ? m[1] : field
  return fieldLabels(t)[key] ?? key
}

function DiffView({ changes }: { changes: NonNullable<ImproveResult['diff']>['changes'] }) {
  const { t } = useTranslation()
  if (!changes.length) {
    return (
      <div style={{ color: 'var(--tx-dim)', fontSize: 13, padding: '16px 0', textAlign: 'center' }}>
        {t('workbench.diff.noChanges')}
      </div>
    )
  }

  const addedCount   = changes.filter(c => c.type === 'added').length
  const changedCount = changes.filter(c => c.type === 'changed').length
  const removedCount = changes.filter(c => c.type === 'removed').length

  // Build section → item → changes map preserving insertion order
  const sections = new Map<string, Map<string, NonNullable<ImproveResult['diff']>['changes']>>()
  for (const change of changes) {
    const sk = diffSectionKey(change.field)
    const ik = diffItemKey(change.field)
    if (!sections.has(sk)) sections.set(sk, new Map())
    const items = sections.get(sk)!
    if (!items.has(ik)) items.set(ik, [])
    items.get(ik)!.push(change)
  }

  return (
    <>
      {/* Header */}
      <div className="diff-header">
        <span className="diff-header-title">{t('workbench.diff.changeHistory')}</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {addedCount   > 0 && <span className="diff-pill diff-pill-add">+{t('workbench.diff.addedPill', { count: addedCount })}</span>}
          {changedCount > 0 && <span className="diff-pill diff-pill-chg">✎ {t('workbench.diff.changedPill', { count: changedCount })}</span>}
          {removedCount > 0 && <span className="diff-pill diff-pill-del">−{t('workbench.diff.removedPill', { count: removedCount })}</span>}
        </div>
      </div>

      {/* Sections */}
      {DIFF_SECTION_ORDER.filter(sk => sections.has(sk)).map(sk => {
        const items = sections.get(sk)!
        const allInSection = [...items.values()].flat()
        const sAdd = allInSection.filter(c => c.type === 'added').length
        const sChg = allInSection.filter(c => c.type === 'changed').length
        const sDel = allInSection.filter(c => c.type === 'removed').length
        return (
          <div key={sk} className="diff-section">
            <div className="diff-section-header">
              <span className="diff-section-label">{diffSectionLabels(t)[sk]}</span>
              {sAdd > 0 && <span className="diff-count diff-count-add">+{sAdd}</span>}
              {sChg > 0 && <span className="diff-count diff-count-chg">{t('workbench.diff.chgCount', { count: sChg })}</span>}
              {sDel > 0 && <span className="diff-count diff-count-del">−{sDel}</span>}
            </div>

            {[...items.entries()].map(([ik, fieldChanges]) => {
              const blockLabel = diffItemLabel(t, ik)
              return (
                <div key={ik} className="diff-block">
                  <div className="diff-block-path">{blockLabel}</div>
                  {fieldChanges.map((change, ci) => {
                    const sub = diffSubLabel(t, change.field)
                    const showSub = sub !== blockLabel
                    const before = change.before != null ? String(change.before).trim() : ''
                    const after  = change.after  != null ? String(change.after).trim()  : ''
                    return (
                      <div key={ci} className="diff-change-row">
                        {showSub && <div className="diff-sub-label">{sub}</div>}
                        {change.type === 'changed' ? (
                          <div className="diff-change-pair">
                            {before && (
                              <div className="diff-line diff-line-chg-before">
                                <span className="diff-marker">−</span>
                                <span className="diff-line-text">{before}</span>
                              </div>
                            )}
                            {(after || change.after) && (
                              <div className="diff-line diff-line-chg-after">
                                <span className="diff-marker">+</span>
                                <span className="diff-line-text">{after || change.after}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            {change.type === 'removed' && before && (
                              <div className="diff-line diff-line-del">
                                <span className="diff-marker">−</span>
                                <span className="diff-line-text">{before}</span>
                              </div>
                            )}
                            {change.type === 'added' && (after || change.after) && (
                              <div className="diff-line diff-line-add">
                                <span className="diff-marker">+</span>
                                <span className="diff-line-text">{after || change.after}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

// issue.title from the backend is a fixed English label derived from issue.rule
// (see _RULE_LABELS in app/schemas/analysis.py) — never free text.
// Map by rule id instead of parsing the title text.
function ruleLabels(t: TFunction): Record<string, string> {
  return {
    title: t('workbench.editable.titleLabel'),
    description: t('workbench.testCase.descriptionLabel'),
    preconditions: t('workbench.diff.sectionPreconditions'),
    steps: t('workbench.testCase.stepsLabel'),
    postconditions: t('workbench.diff.sectionPostconditions'),
    priority: t('workbench.editable.priorityLabel'),
    expected_results: t('workbench.rule.expectedResults'),
    test_data: t('workbench.steps.colTestData'),
    tags: t('workbench.testCase.tagsLabel'),
    atomicity: t('workbench.rule.atomicity'),
    independence: t('workbench.rule.independence'),
    reproducibility: t('workbench.rule.reproducibility'),
  }
}

function issueTitle(t: TFunction, issue: ReviewIssue): string {
  return (issue.rule && ruleLabels(t)[issue.rule]) ?? issue.title
}

function parseIssueDescription(description: string): { text: string; evidence: string | null } {
  const match = description.match(/^([\s\S]*?)\s*Example:\s*([\s\S]*)$/i)
  if (!match) return { text: description.trim(), evidence: null }
  return { text: match[1].trim(), evidence: match[2].trim() || null }
}

function IssueRow({ issue, resolution, hasImprovement, ruleDescription, onDismiss }: {
  issue: ReviewIssue
  resolution: IssueResolution | undefined
  hasImprovement: boolean
  ruleDescription?: string
  onDismiss?: () => void
}) {
  const { t } = useTranslation()
  const isResolved = resolution?.status === 'resolved'
  const borderClass = isResolved ? 'iborder-resolved' :
    issue.severity === 'high' ? 'iborder-h' :
    issue.severity === 'medium' ? 'iborder-m' : 'iborder-l'
  const { text: description, evidence } = parseIssueDescription(issue.description)
  return (
    <div className={`issue-row ${borderClass}${isResolved ? ' issue-row-resolved' : ''}`}>
      <div className="issue-body">
        <div className="issue-title-text" title={ruleDescription}>{issueTitle(t, issue)}</div>
        {description && <div className="issue-loc">{description}</div>}
        {evidence && <div className="issue-evidence">{evidence}</div>}
        {resolution?.status === 'manual_needed' && resolution.reason && (
          <div className="issue-reason">{resolution.reason}</div>
        )}
      </div>
      {resolution?.status === 'resolved' && (
        <span className="issue-badge ib-resolved" title={t('workbench.issue.resolvedTitle')}>{t('workbench.issue.resolvedBadge')}</span>
      )}
      {resolution?.status === 'manual_needed' && (
        <span className="issue-badge ib-manual" title={t('workbench.issue.manualTitle')}>{t('workbench.issue.manualBadge')}</span>
      )}
      {resolution?.status === 'skipped' && (
        <span className="issue-badge ib-skipped" title={t('workbench.issue.skippedTitle')}>{t('workbench.issue.skippedBadge')}</span>
      )}
      {hasImprovement && !resolution && (
        <span className="issue-badge ib-skipped" title={t('workbench.issue.notProcessedTitle')}>{t('workbench.issue.notProcessedBadge')}</span>
      )}
      {onDismiss && (
        <button type="button" className="issue-dismiss-btn" onClick={onDismiss} title={t('workbench.issue.dismissTitle')}>
          <X size={11} />
        </button>
      )}
    </div>
  )
}

function RailLoading() {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--accent)', fontSize: 12, fontWeight: 500 }}>
        <span className="spinner"><Sparkles size={13} /></span>
        {t('workbench.rail.analyzingTestCase')}
      </div>
      {[75, 55, 65, 45, 60].map((w, i) => (
        <div key={i} style={{ height: 11, borderRadius: 4, width: `${w}%` }} className="skel" />
      ))}
    </div>
  )
}

// TODO: source from backend once GET /testit/sections (or create-draft response) exposes it
const DRAFT_SECTION_NAME = 'AI Review / Drafts'

function ConfirmApplyModal({
  workItemId,
  loading,
  onConfirm,
  onCancel,
}: {
  workItemId: string
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="action-modal-overlay" onClick={loading ? undefined : onCancel}>
      <div className="action-modal action-modal-destructive" onClick={e => e.stopPropagation()}>
        <div className="action-modal-header action-modal-header-destructive">
          <span className="action-modal-icon-destructive">
            <AlertTriangle size={18} strokeWidth={1.75} />
          </span>
          <div>
            <div className="action-modal-title">{t('workbench.confirmApply.title')}</div>
            <div className="action-modal-subtitle">#{workItemId}</div>
          </div>
        </div>
        <div className="action-modal-body">
          {t('workbench.confirmApply.body')}
          <div className="action-modal-warn-text">
            <span className="action-modal-warn-dot" />
            {t('workbench.confirmApply.warnText')}
          </div>
        </div>
        <div className="action-modal-footer">
          <button type="button" className="wb-btn wb-btn-sec" onClick={onCancel} disabled={loading}>
            {t('workbench.common.cancel')}
          </button>
          <button type="button" className="wb-btn-danger" onClick={onConfirm} disabled={loading}>
            {loading
              ? <><Loader2 size={13} className="spin-icon" /> {t('workbench.confirmApply.applying')}</>
              : <><AlertTriangle size={13} /> {t('workbench.confirmApply.replace')}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

export function Workbench({ fetchResult, reviewConfig, selectedPreset, enabledRules, onApply, onBack }: Props) {
  const { t } = useTranslation()
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null)
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [improveResult, setImproveResult] = useState<ImproveResult | null>(null)
  const [improveLoading, setImproveLoading] = useState(false)
  const [improveError, setImproveError] = useState<string | null>(null)
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [showConfirmApply, setShowConfirmApply] = useState(false)
  const [activeTab, setActiveTab] = useState<'original' | 'improved' | 'diff' | 'json'>('original')
  const [dismissedIndices, setDismissedIndices] = useState<Set<number>>(new Set())
  const [showDismissed, setShowDismissed] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [editedTestCase, setEditedTestCase] = useState<TestCase | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editSnapshot, setEditSnapshot] = useState<TestCase | null>(null)
  const [manualOverride, setManualOverride] = useState(false)
  // Snapshot of the issues actually sent to /improve-testcase — issue_resolutions[].issue_index
  // refers to positions in THIS array. Must not be recomputed from live enabledRules/dismissedIndices,
  // which can change after the request was sent and silently misattribute resolutions to the wrong issue.
  const [improveSelectedIssues, setImproveSelectedIssues] = useState<ReviewIssue[]>([])

  const tc = fetchResult.normalized_testcase
  const initialEnabledRules = useRef(enabledRules)
  // What each rule actually checks — shown as a tooltip on the issue's short label,
  // since e.g. "Independence" alone doesn't say what independence means here.
  const ruleDescriptions = Object.fromEntries(reviewConfig.rules.map(r => [r.id, r.description]))

  useEffect(() => {
    let cancelled = false

    async function doAnalyze() {
      setAnalyzeLoading(true)
      setAnalyzeError(null)
      setAnalyzeResult(null)
      setImproveResult(null)
      setImproveError(null)
      setDraftResult(null)
      setDismissedIndices(new Set())
      setImproveSelectedIssues([])
      setActiveTab('original')
      try {
        const result = await api.analyzeTestCase({
          work_item: fetchResult.raw_work_item,
          enabled_rules: initialEnabledRules.current,
        })
        if (!cancelled) setAnalyzeResult(result)
      } catch (err) {
        if (!cancelled) setAnalyzeError((err as Error).message)
      } finally {
        if (!cancelled) setAnalyzeLoading(false)
      }
    }

    doAnalyze()
    return () => { cancelled = true }
  }, []) // initial mount only; rule changes handled by runAnalyze

  async function runAnalyze() {
    setAnalyzeLoading(true)
    setAnalyzeError(null)
    setAnalyzeResult(null)
    setImproveResult(null)
    setImproveError(null)
    setDraftResult(null)
    setDismissedIndices(new Set())
    setImproveSelectedIssues([])
    setApplyResult(null)
    setActiveTab('original')
    try {
      const result = await api.analyzeTestCase({
        work_item: fetchResult.raw_work_item,
        enabled_rules: enabledRules,
      })
      setAnalyzeResult(result)
    } catch (err) {
      setAnalyzeError((err as Error).message)
    } finally {
      setAnalyzeLoading(false)
    }
  }
  // Note: initial analysis on mount uses the useEffect below with cancel-flag
  // to prevent React StrictMode double-invocation from firing two LLM requests

  async function runImprove() {
    if (!analyzeResult) return
    setImproveLoading(true)
    setImproveError(null)
    setImproveResult(null)
    setDraftResult(null)
    setApplyResult(null)
    setManualOverride(false)
    try {
      const enabledRuleSet = new Set<string>(enabledRules)
      const issuesToFix = analyzeResult.issues.filter((i, idx) =>
        (i.rule ? enabledRuleSet.has(i.rule) : true) && !dismissedIndices.has(idx)
      )
      setImproveSelectedIssues(issuesToFix)
      const result = await api.improveTestCase({
        work_item: fetchResult.raw_work_item,
        selected_issues: issuesToFix,
        enabled_rules: enabledRules,
      })
      setImproveResult(result)
      setEditedTestCase(result.improved_testcase)
      setIsEditing(false)
      setActiveTab('improved')
    } catch (err) {
      setImproveError((err as Error).message)
      setActiveTab('improved')
    } finally {
      setImproveLoading(false)
    }
  }

  async function runCreateDraft() {
    if (!improveResult) return
    setDraftLoading(true)
    setDraftError(null)
    try {
      const result = await api.createDraft({
        improved_testcase: editedTestCase ?? improveResult.improved_testcase,
        source_work_item_id: fetchResult.work_item_id,
        source_attributes: (fetchResult.raw_work_item.attributes ?? {}) as Record<string, unknown>,
        manual_notes: improveResult.manual_notes ?? [],
      })
      setDraftResult(result)
    } catch (err) {
      setDraftError(humanizeDraftError((err as Error).message))
    } finally {
      setDraftLoading(false)
    }
  }

  async function runApplyToOriginal() {
    if (!improveResult) return
    setApplyLoading(true)
    setApplyError(null)
    setApplyResult(null)
    try {
      const result = await api.applyToOriginal({
        improved_testcase: editedTestCase ?? improveResult.improved_testcase,
        source_work_item_id: fetchResult.work_item_id,
        source_attributes: (fetchResult.raw_work_item.attributes ?? {}) as Record<string, unknown>,
      })
      setApplyResult(result)
    } catch (err) {
      setApplyError((err as Error).message)
    } finally {
      setApplyLoading(false)
      setShowConfirmApply(false)
    }
  }

  function computeScore(issues: ReviewIssue[]) {
    let s = 100
    for (const i of issues) s -= i.severity === 'high' ? 20 : i.severity === 'medium' ? 10 : 5
    return Math.max(0, s)
  }

  function getResolution(issue: ReviewIssue): IssueResolution | undefined {
    const selectedIdx = improveSelectedIssues.indexOf(issue)
    if (selectedIdx === -1) return undefined
    return improveResult?.issue_resolutions?.find(r => r.issue_index === selectedIdx)
  }

  const unresolvedIssues = analyzeResult?.issues.filter(issue => {
    const selectedIdx = improveSelectedIssues.indexOf(issue)
    if (selectedIdx === -1) return true
    return !improveResult?.issue_resolutions?.some(r => r.issue_index === selectedIdx && r.status === 'resolved')
  }) ?? analyzeResult?.issues
  const score = analyzeResult ? computeScore(improveResult ? (unresolvedIssues ?? []) : analyzeResult.issues) : null
  const R = 22
  const CIRC = 2 * Math.PI * R
  const scoreArc = score !== null ? (score / 100) * CIRC : 0

  const allIssuesWithIdx = (analyzeResult?.issues ?? []).map((issue, idx) => ({ issue, idx }))
  const visibleIssues = allIssuesWithIdx.filter(({ idx }) => !dismissedIndices.has(idx))
  const dismissedIssuesList = allIssuesWithIdx.filter(({ idx }) => dismissedIndices.has(idx))
  // Split visible into unresolved (needs attention) and resolved (done)
  const unresolvedVisible = visibleIssues.filter(({ issue }) => getResolution(issue)?.status !== 'resolved')
  const resolvedVisible = visibleIssues.filter(({ issue }) => getResolution(issue)?.status === 'resolved')
  const highIssues = unresolvedVisible.filter(({ issue }) => issue.severity === 'high')
  const medIssues = unresolvedVisible.filter(({ issue }) => issue.severity === 'medium')
  const lowIssues = unresolvedVisible.filter(({ issue }) => issue.severity === 'low')

  const resolvedCount = improveResult?.issue_resolutions?.filter(r => r.status === 'resolved').length ?? 0
  const manualCount = improveResult?.issue_resolutions?.filter(r => r.status === 'manual_needed').length ?? 0
  // After the user manually edits and saves, treat manual-review items as addressed.
  const effectiveManualCount = manualOverride ? 0 : manualCount

  function scoreBadge(s: number) {
    if (s >= 85) return t('workbench.rail.scoreExcellent')
    if (s >= 70) return t('workbench.rail.scoreGood')
    if (s >= 50) return t('workbench.rail.scoreFair')
    return t('workbench.rail.scorePoor')
  }

  const SCORE_BADGE_TOOLTIP = t('workbench.rail.scoreBadgeTooltip')

  function scoreBadgeClass(s: number) {
    if (s >= 70) return 'score-good'
    if (s >= 50) return 'score-fair'
    return 'score-poor'
  }

  const hasImprove = !!improveResult
  const hasDraft = !!draftResult
  const analyzeFailed = (analyzeResult?.warnings ?? []).includes(LLM_UNAVAILABLE_WARNING)

  const hasApply = !!applyResult
  const diffCount = improveResult?.diff?.changes?.length

  // Strip service footer from LLM-generated description before display
  function stripServiceFooter(desc: string): string {
    const sep = '\n\n---\n'
    const idx = desc.indexOf(sep)
    return idx === -1 ? desc : desc.slice(0, idx).trim()
  }

  // TODO: result_status — placeholder until backend provides explicit field.
  // Detects partial: validation errors, empty critical fields, or unprocessed service footer.
  // suppressManual: user manually edited and saved the test case — the AI-computed
  // call-outs (manual_notes, validation_warnings, service footer) are now stale and
  // no longer block completion. Title/steps are re-checked against the CURRENT
  // (possibly edited) test case, since those are trivial to verify live and editing
  // them is exactly what the user just did.
  function computeImproveStatus(r: ImproveResult, current: TestCase, suppressManual: boolean): 'success' | 'partial' {
    if (!suppressManual) {
      if ((r.manual_notes?.length ?? 0) > 0) return 'partial'
      if ((r.validation_warnings?.length ?? 0) > 0) return 'partial'
    }
    if (!current.title?.trim()) return 'partial'
    if (!current.steps?.length) return 'partial'
    if (!suppressManual) {
      const desc = current.description ?? ''
      const origDesc = String((r.original_normalized_testcase as Record<string, unknown>)?.description ?? '')
      if (SERVICE_FOOTER_MARKERS.some(m => desc.includes(m) && !origDesc.includes(m))) return 'partial'
    }
    return 'success'
  }

  // Humanize improve errors for display
  function humanizeImproveError(msg: string): string {
    const m = msg.toLowerCase()
    if (m.includes('timeout') || m.includes('timed out')) return t('workbench.errors.aiTimeout')
    if (m.includes('500') || m.includes('internal')) return t('workbench.errors.aiInternalError')
    if (m.includes('429') || m.includes('rate')) return t('workbench.errors.aiRateLimited')
    if (m.includes('503') || m.includes('unavailable')) return t('workbench.errors.aiUnavailable')
    if (m.includes('502')) return t('workbench.errors.aiInvalidResponse')
    return t('workbench.errors.genericProcessingError')
  }

  const improveStatus: 'success' | 'partial' | 'error' | null = improveError
    ? 'error'
    : improveResult
    ? computeImproveStatus(improveResult, editedTestCase ?? improveResult.improved_testcase, manualOverride)
    : null

  const openCriticalCount = analyzeResult?.issues.filter((issue, absIdx) => {
    if (issue.severity !== 'high') return false
    if (dismissedIndices.has(absIdx)) return false
    const selectedIdx = improveSelectedIssues.indexOf(issue)
    if (selectedIdx === -1) return true
    return !improveResult?.issue_resolutions?.some(r => r.issue_index === selectedIdx && r.status === 'resolved')
  }).length ?? 0

  const canDraft = (improveStatus === 'success' || improveStatus === 'partial') && !applyResult
  const canApply = improveStatus === 'success' && openCriticalCount === 0 && effectiveManualCount === 0 && !applyResult
  const applyBlockReason = improveStatus === 'partial'
    ? t('workbench.actions.blockReasonPartial')
    : openCriticalCount > 0 && effectiveManualCount > 0
      ? t('workbench.actions.blockReasonCriticalAndManual', { critical: openCriticalCount, manual: effectiveManualCount })
      : openCriticalCount > 0
        ? t('workbench.actions.blockReasonCritical', { count: openCriticalCount })
        : effectiveManualCount > 0
          ? t('workbench.actions.blockReasonManual', { count: effectiveManualCount })
          : null

  // Fields empty in improved result when AI partially processed — shown as ⚠ не обработано
  const partialFields = new Set<string>()
  if (improveStatus === 'partial' && improveResult) {
    const it = editedTestCase ?? improveResult.improved_testcase
    if (!it.title?.trim()) partialFields.add('title')
    if (!it.description?.trim() && tc.description?.trim()) partialFields.add('description')
    if (!it.steps?.length) partialFields.add('steps')
    if (!it.preconditions?.length && tc.preconditions?.length) partialFields.add('preconditions')
  }

  // Merge improved with original read-only metadata; strip service footer from description
  const mergedImproved: TestCase | null = improveResult ? {
    ...improveResult.improved_testcase,
    description: stripServiceFooter(improveResult.improved_testcase.description ?? ''),
    links: tc.links,
    attachments: tc.attachments,
    parameter_table: tc.parameter_table,
    section_name: tc.section_name,
    attributes: tc.attributes,
    display_duration: improveResult.display_duration ?? tc.display_duration,
  } : null

  // mergedEdited: same as mergedImproved but using user-edited testcase
  const mergedEdited: TestCase | null = editedTestCase && improveResult ? {
    ...editedTestCase,
    description: stripServiceFooter(editedTestCase.description ?? ''),
    links: tc.links,
    attachments: tc.attachments,
    parameter_table: tc.parameter_table,
    section_name: tc.section_name,
    attributes: tc.attributes,
    display_duration: improveResult.display_duration ?? tc.display_duration,
  } : mergedImproved

  const improvedTabAccessible = hasImprove || !!improveError
  const tabs = [
    { id: 'original' as const, label: t('workbench.tabs.original'), disabled: false, count: null },
    { id: 'improved' as const, label: t('workbench.tabs.improved'), disabled: !improvedTabAccessible,
      count: improveStatus === 'success' ? '✓' : improveStatus === 'partial' ? '!' : improveStatus === 'error' ? '✕' : null },
    { id: 'diff' as const, label: t('workbench.tabs.changes'), disabled: !hasImprove, count: diffCount ? String(diffCount) : null },
    { id: 'json' as const, label: t('workbench.tabs.json'), disabled: false, count: null },
  ]

  const isLoading = analyzeLoading || improveLoading || draftLoading
  const bannerNotifications: ActionNotification[] = [
    ...(draftResult ? [{
      type: 'draft' as const,
      id: draftResult.global_id != null ? String(draftResult.global_id) : draftResult.work_item_id,
      testit_url: draftResult.testit_url,
      sectionName: draftResult.section_name ?? DRAFT_SECTION_NAME,
      isPartial: improveStatus === 'partial' || effectiveManualCount > 0,
    }] : []),
    ...(applyResult ? [{
      type: 'apply' as const,
      id: applyResult.global_id != null ? String(applyResult.global_id) : applyResult.work_item_id,
      testit_url: applyResult.testit_url,
    }] : []),
  ]

  return (
    <>
      <ProgressBar active={isLoading} />
    <div className="workspace-inner-wb">

      {/* Page header */}
      <SectionHeader
        title={t('app.reviewImproveTitle')}
        onBack={onBack}
        actions={
          <ModeButton
            reviewConfig={reviewConfig}
            selectedPreset={selectedPreset}
            enabledRules={enabledRules}
            onApply={onApply}
          />
        }
      />

      {/* Workbench header card */}
      <div className="wb-card">
        <div className="wb-card-left">
          <div className="wb-title">{tc.title || '—'}</div>
          <div className="wb-meta-row">
            <span className="wb-source-badge">TestIT</span>
            <span className="wb-source-id">#{fetchResult.work_item_id}</span>
            {analyzeLoading && (
              <span className="wb-status-analyzed">
                <span className="spinner" style={{ display: 'inline-flex' }}><Sparkles size={12} /></span>
                {t('workbench.processStatus.analyzing')}
              </span>
            )}
            {analyzeResult && !improveStatus && (
              <span className="wb-status-analyzed">
                <Sparkles size={12} />
                {t('workbench.header.issuesCount', { count: analyzeResult.issues.length })}
              </span>
            )}
            {improveStatus === 'success' && (
              <span className="wb-status-ok">
                <CheckCircle2 size={13} />
                {t('workbench.processStatus.improved')}
              </span>
            )}
            {improveStatus === 'partial' && (
              <span className="wb-status-partial">
                <AlertTriangle size={13} />
                {t('workbench.processStatus.needsReview')}
              </span>
            )}
            {improveStatus === 'error' && (
              <span className="wb-status-err">
                <AlertTriangle size={13} />
                {t('workbench.processStatus.improveError')}
              </span>
            )}
            {improveStatus === 'success' && resolvedCount > 0 && (
              <span className="wb-metric wb-metric-ok">
                <Check size={11} strokeWidth={2.5} />
                {t('workbench.header.resolvedCount', { count: resolvedCount })}
              </span>
            )}
            {improveStatus && improveStatus !== 'error' && effectiveManualCount > 0 && (
              <span className="wb-metric wb-metric-warn">
                <AlertTriangle size={11} />
                {t('workbench.header.manualCount', { count: effectiveManualCount })}
              </span>
            )}
          </div>
        </div>
        <div className="wb-actions">
          {/* Initial loading — no prior result yet */}
          {analyzeLoading && !analyzeResult && (
            <button type="button" className="wb-btn wb-btn-sec" disabled>
              <span className="spinner" style={{ display: 'inline-flex' }}><Sparkles size={13} /></span>
              {t('workbench.processStatus.analyzing')}
            </button>
          )}
          {/* Re-run analyze */}
          {analyzeResult && (
            <button
              type="button" className="wb-btn wb-btn-sec"
              onClick={runAnalyze}
              disabled={analyzeLoading || improveLoading}
            >
              <RotateCcw size={13} />
              {t('workbench.actions.rerunReview')}
            </button>
          )}
          {/* Improve / retry */}
          {analyzeResult && (
            improveLoading ? (
              <button type="button" className="wb-btn wb-btn-sec" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><Wand2 size={13} /></span>
                {t('workbench.actions.improving')}
              </button>
            ) : improveStatus === 'error' ? (
              <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}
                disabled={analyzeFailed}
                title={analyzeFailed ? t('workbench.actions.analyzeFailedTooltip') : undefined}>
                <RotateCcw size={13} />
                {t('workbench.actions.retry')}
              </button>
            ) : hasImprove ? (
              <button type="button" className="wb-btn wb-btn-sec" onClick={runImprove}
                disabled={improveLoading || analyzeLoading || analyzeFailed}
                title={analyzeFailed ? t('workbench.actions.analyzeFailedTooltip') : undefined}>
                <Wand2 size={13} />
                {t('workbench.actions.improveAgain')}
              </button>
            ) : (
              <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}
                disabled={analyzeFailed}
                title={analyzeFailed ? t('workbench.actions.analyzeFailedTooltip') : undefined}>
                <Wand2 size={13} />
                {t('workbench.actions.improve')}
              </button>
            )
          )}
          {/* Draft */}
          {improvedTabAccessible && improveStatus !== 'error' && (
            hasDraft ? (
              <button type="button" className="wb-btn wb-btn-done" disabled>
                <CheckCircle2 size={13} />
                {t('workbench.actions.draftCreated')}
              </button>
            ) : draftLoading ? (
              <button type="button" className="wb-btn wb-btn-sec" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><CheckCircle2 size={13} /></span>
                {t('workbench.actions.creatingDraft')}
              </button>
            ) : canDraft ? (
              <button
                type="button"
                className={`wb-btn ${improveStatus === 'partial' ? 'wb-btn-sec-warn' : 'wb-btn-sec'}`}
                title={improveStatus === 'partial' ? t('workbench.actions.draftPartialTooltip') : undefined}
                onClick={() => runCreateDraft()}
              >
                <CheckCircle2 size={13} />
                {t('workbench.actions.createDraft')}
              </button>
            ) : null
          )}
          {/* Apply to original */}
          {improvedTabAccessible && improveStatus !== 'error' && (
            hasApply ? (
              <button type="button" className="wb-btn wb-btn-done" disabled>
                <CheckCircle2 size={13} />
                {t('workbench.actions.applied')}
              </button>
            ) : applyLoading ? (
              <button type="button" className="wb-btn-apply" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><Wand2 size={13} /></span>
                {t('workbench.actions.applyingToOriginal')}
              </button>
            ) : (
              <div className="wb-btn-wrap">
                <button
                  type="button"
                  className="wb-btn-apply"
                  disabled={!canApply}
                  onClick={() => canApply && setShowConfirmApply(true)}
                >
                  <CheckCircle2 size={13} />
                  {t('workbench.actions.applyToOriginal')}
                </button>
                {!canApply && applyBlockReason && (
                  <span className="wb-btn-tip">{applyBlockReason}</span>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* Confirm apply modal */}
      {showConfirmApply && (
        <ConfirmApplyModal
          workItemId={fetchResult.work_item_id}
          loading={applyLoading}
          onConfirm={runApplyToOriginal}
          onCancel={() => setShowConfirmApply(false)}
        />
      )}

      {/* Draft error */}
      {draftError && (
        <div className="alert alert-error" style={{ margin: '0 0 8px' }}>
          <span className="alert-text">{t('workbench.errors.draftErrorPrefix')}{draftError}</span>
        </div>
      )}

      {/* Apply error */}
      {applyError && (
        <div className="alert alert-error" style={{ margin: '0 0 8px' }}>
          <span className="alert-text">{t('workbench.errors.applyErrorPrefix')}{applyError}</span>
        </div>
      )}

      {/* Action result banner */}
      <ActionBanner notifications={bannerNotifications} />

      {/* Workbench grid */}
      <div className="wb-grid">

        {/* Left: test case panel */}
        <div className="wb-main">
          <div className="wb-tabs-row">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`wb-tab${activeTab === tab.id ? ' wb-tab-active' : ''}${tab.disabled ? ' wb-tab-disabled' : ''}`}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                disabled={tab.disabled}
              >
                {tab.label}
                {tab.count && <span className="wb-tab-count">{tab.count}</span>}
              </button>
            ))}
            {activeTab === 'improved' && hasImprove && !isEditing && (
              <button
                type="button"
                className="tc-edit-toggle"
                style={{ marginLeft: 'auto', alignSelf: 'center' }}
                onClick={() => { setEditSnapshot(editedTestCase); setIsEditing(true) }}
              >
                <Wrench size={11} />
                {t('workbench.editable.editButton')}
              </button>
            )}
            {activeTab === 'improved' && hasImprove && isEditing && (
              <div style={{ marginLeft: 'auto', alignSelf: 'center', display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="tc-edit-toggle"
                  onClick={() => { setEditedTestCase(editSnapshot); setIsEditing(false) }}
                >
                  <X size={11} />
                  {t('workbench.common.cancel')}
                </button>
                <button
                  type="button"
                  className="tc-edit-toggle tc-edit-toggle-active"
                  onClick={() => {
                    setIsEditing(false)
                    if (manualCount > 0 || (improveResult?.manual_notes?.length ?? 0) > 0) setManualOverride(true)
                  }}
                >
                  <Check size={11} />
                  {t('workbench.common.save')}
                </button>
              </div>
            )}
          </div>
          <div className="wb-content">
            {activeTab === 'original' && <TestCaseView tc={tc} />}
            {activeTab === 'improved' && improveStatus === 'error' && (
              <div className="improve-error-block">
                <AlertTriangle size={24} className="improve-error-icon" />
                <div className="improve-error-body">
                  <div className="improve-error-title">{t('workbench.errors.failedToImprove')}</div>
                  <div className="improve-error-msg">{humanizeImproveError(improveError ?? '')}</div>
                </div>
                <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                  <RotateCcw size={13} />
                  {t('workbench.actions.retry')}
                </button>
              </div>
            )}
            {activeTab === 'improved' && improveStatus === 'partial' && mergedEdited && (
              <>
                <div className="improve-partial-banner">
                  <AlertTriangle size={14} />
                  <div>
                    <span>{t('workbench.processStatus.partialBanner')}</span>
                    {(improveResult?.validation_warnings?.length ?? 0) > 0 && (
                      <span className="improve-partial-detail">
                        {improveResult!.validation_warnings!.join('; ')}
                      </span>
                    )}
                  </div>
                </div>
                {isEditing && editedTestCase
                  ? <EditableTestCaseView tc={editedTestCase} onChange={setEditedTestCase} />
                  : <div className="tc-fade-in"><TestCaseView tc={mergedEdited} partialFields={partialFields} /></div>
                }
              </>
            )}
            {activeTab === 'improved' && improveStatus === 'success' && mergedEdited && (
              isEditing && editedTestCase
                ? <EditableTestCaseView tc={editedTestCase} onChange={setEditedTestCase} />
                : <div className="tc-fade-in"><TestCaseView tc={mergedEdited} /></div>
            )}
            {activeTab === 'diff' && (
              <div className="tc-fade-in"><DiffView changes={improveResult?.diff?.changes ?? []} /></div>
            )}
            {activeTab === 'json' && (
              <pre className="wb-json-pre">
                {JSON.stringify(hasImprove ? (editedTestCase ?? improveResult!.improved_testcase) : tc, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* Right: AI Review rail */}
        <div className="rail-panel">
          <div className="rail-head">
            <span className="rail-title">{t('workbench.rail.title')}</span>
            {analyzeResult && <span className="rail-count">{analyzeResult.issues.length}</span>}
          </div>
          <div className="rail-scroll">
            {analyzeLoading && <RailLoading />}
            {analyzeError && (
              <div className="alert alert-error">
                <span className="alert-text">{analyzeError}</span>
              </div>
            )}
            {analyzeResult && (
              <div className="rail-result">
                {/* Score card */}
                {score !== null && (
                  <div className="score-card">
                    <div className="score-head">{t('workbench.rail.qualityScore')}</div>
                    <div className="score-main">
                      <div className="score-ring">
                        <svg viewBox="0 0 56 56" width="56" height="56">
                          <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(220,224,238,0.9)" strokeWidth="5" />
                          <circle
                            cx="28" cy="28" r={R} fill="none" stroke="#0369a1" strokeWidth="5"
                            strokeDasharray={`${scoreArc.toFixed(1)} ${CIRC.toFixed(1)}`}
                            strokeLinecap="round"
                            style={{ transform: 'rotate(-90deg)', transformOrigin: '28px 28px' }}
                          />
                        </svg>
                        <div className="score-overlay">
                          <span className="score-num">{score}</span>
                          <span className="score-den">/100</span>
                        </div>
                      </div>
                      <div className="score-copy">
                        <span className={`score-badge ${scoreBadgeClass(score)}`} title={SCORE_BADGE_TOOLTIP}>{scoreBadge(score)}</span>
                        <div className="score-ctrs">
                          {hasImprove && resolvedCount > 0 && (
                            <span className="score-ctr sctr-ok">
                              <Check size={11} strokeWidth={2.5} />{t('workbench.header.resolvedCount', { count: resolvedCount })}
                            </span>
                          )}
                          {hasImprove && effectiveManualCount > 0 && (
                            <span className="score-ctr sctr-warn">
                              <AlertTriangle size={11} />{t('workbench.header.manualCount', { count: effectiveManualCount })}
                            </span>
                          )}
                          {!hasImprove && (
                            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>
                              {t('workbench.header.issuesCount', { count: analyzeResult.issues.length })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* AI summary */}
                <div className="ai-summary">
                  <div className="ai-label">
                    <Sparkles size={11} />
                    {t('workbench.rail.title')}
                  </div>
                  <div className="ai-text">{analyzeResult.summary}</div>
                </div>

                {/* Manual work banner — top priority, shown first */}
                {hasImprove && !manualOverride && (improveResult!.manual_notes?.length ?? 0) > 0 && (
                  <div className="manual-banner">
                    <div className="mb-head">
                      <Wrench size={13} />
                      {t('workbench.rail.manualWorkHeading')}
                    </div>
                    {improveResult!.manual_notes!.map((note, i) => (
                      <div key={i} className="mb-item">
                        <div className="mb-item-title">{note}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Unresolved issues by severity */}
                {highIssues.length > 0 && (
                  <div>
                    <div className="issues-section-label isl-high">{t('workbench.rail.criticalSection', { count: highIssues.length })}</div>
                    {highIssues.map(({ issue, idx }) => (
                      <IssueRow key={idx} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove}
                        ruleDescription={issue.rule ? ruleDescriptions[issue.rule] : undefined}
                        onDismiss={() => setDismissedIndices(prev => new Set([...prev, idx]))} />
                    ))}
                  </div>
                )}
                {medIssues.length > 0 && (
                  <div>
                    <div className="issues-section-label isl-medium">{t('workbench.rail.mediumSection', { count: medIssues.length })}</div>
                    {medIssues.map(({ issue, idx }) => (
                      <IssueRow key={idx} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove}
                        ruleDescription={issue.rule ? ruleDescriptions[issue.rule] : undefined}
                        onDismiss={() => setDismissedIndices(prev => new Set([...prev, idx]))} />
                    ))}
                  </div>
                )}
                {lowIssues.length > 0 && (
                  <div>
                    <div className="issues-section-label isl-low">{t('workbench.rail.lowSection', { count: lowIssues.length })}</div>
                    {lowIssues.map(({ issue, idx }) => (
                      <IssueRow key={idx} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove}
                        ruleDescription={issue.rule ? ruleDescriptions[issue.rule] : undefined}
                        onDismiss={() => setDismissedIndices(prev => new Set([...prev, idx]))} />
                    ))}
                  </div>
                )}

                {/* Resolved issues — collapsed group at the bottom */}
                {resolvedVisible.length > 0 && (
                  <div className="resolved-section">
                    <button type="button" className="resolved-toggle" onClick={() => setShowResolved(v => !v)}>
                      <Check size={11} strokeWidth={2.5} />
                      {t('workbench.rail.resolvedToggle')}
                      <span className="resolved-toggle-count">{resolvedVisible.length}</span>
                      <span className="resolved-toggle-hint">{showResolved ? '▲' : '▼'}</span>
                    </button>
                    {showResolved && resolvedVisible.map(({ issue, idx }) => (
                      <IssueRow key={idx} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove}
                        ruleDescription={issue.rule ? ruleDescriptions[issue.rule] : undefined}
                        onDismiss={() => setDismissedIndices(prev => new Set([...prev, idx]))} />
                    ))}
                  </div>
                )}

                {dismissedIssuesList.length > 0 && (
                  <div className="dismissed-section">
                    <button type="button" className="dismissed-toggle" onClick={() => setShowDismissed(v => !v)}>
                      <EyeOff size={11} />
                      {t('workbench.rail.excludedToggle', { count: dismissedIssuesList.length })}
                      <span className="dismissed-toggle-hint">{showDismissed ? '▲' : '▼'}</span>
                    </button>
                    {showDismissed && dismissedIssuesList.map(({ issue, idx }) => (
                      <div key={idx} className="issue-row iborder-resolved issue-row-dismissed">
                        <div className="issue-body">
                          <div
                            className="issue-title-text issue-title-dismissed"
                            title={issue.rule ? ruleDescriptions[issue.rule] : undefined}
                          >{issueTitle(t, issue)}</div>
                        </div>
                        <button type="button" className="issue-restore-btn"
                          onClick={() => setDismissedIndices(prev => { const s = new Set(prev); s.delete(idx); return s })}
                          title={t('workbench.rail.restoreTitle')}>
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {analyzeResult.issues.length === 0 && (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--tx-muted)', fontSize: 13 }}>
                    {t('workbench.rail.noIssuesFound')}
                  </div>
                )}

                {/* Parse / LLM warnings */}
                {((analyzeResult.warnings?.length ?? 0) > 0 || (improveResult?.warnings?.length ?? 0) > 0) && (
                  <div className="parse-warnings-section">
                    {[...(analyzeResult.warnings ?? []), ...(improveResult?.warnings ?? [])].map((w, i) => (
                      <div key={i} className="pw-item">{w}</div>
                    ))}
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
</>
  )
}
