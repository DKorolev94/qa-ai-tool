import { useEffect, useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, EyeOff, FilePlus, Loader2, X,
  ExternalLink, FolderOpen, Link2, Paperclip, RotateCcw, Sparkles, Wand2, Wrench,
} from 'lucide-react'
import { api } from '../api'
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

const PRIORITY_LABELS: Record<string, string> = {
  Highest: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low',
  highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low',
}

// TestIT returns status values in English; map to Russian and badge class
const STATUS_LABELS: Record<string, string> = {
  Ready: 'Ready',
  NotReady: 'Not ready',
  Draft: 'Draft',
  NeedsWork: 'Needs work',
  Obsolete: 'Obsolete',
  InProgress: 'In progress',
}
const STATUS_PILL: Record<string, string> = {
  Ready: 'pill-ok',
  NotReady: 'pill-err',
  Draft: 'pill-neutral',
  NeedsWork: 'pill-warn',
  Obsolete: 'pill-neutral',
  InProgress: 'pill-warn',
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title', description: 'Description',
  preconditions: 'Precondition', postconditions: 'Postcondition',
  tags: 'Tags', priority: 'Priority', status: 'Status', duration: 'Duration',
  expected: 'Expected result', action: 'Action', test_data: 'Test data',
}

function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  const m = field.match(/^steps\.(\d+)\.(.+)$/)
  if (m) return `Step ${parseInt(m[1]) + 1} — ${FIELD_LABELS[m[2]] ?? m[2]}`
  const p = field.match(/^preconditions\.(\d+)\.(.+)$/)
  if (p) return `Precondition ${parseInt(p[1]) + 1} — ${FIELD_LABELS[p[2]] ?? p[2]}`
  return field
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
        <div className="steps-th">Action</div>
        <div className="steps-th">Expected result</div>
        {showTestData && <div className="steps-th">Test data</div>}
        {showComments && <div className="steps-th">Comments</div>}
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

// Link type → Russian label
const LINK_TYPE_LABELS: Record<string, string> = {
  Issue: 'Issue', Defect: 'Defect', Requirement: 'Requirement',
  BlockedBy: 'Blocks', Related: 'Related', Clones: 'Clone',
  Repository: 'Repository',
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
const SERVICE_TAGS = new Set(['ai-generated', 'needs-review'])
const SOURCE_TAG_RE = /^source-(\d+)$/

// Service footer markers that indicate unprocessed LLM response
const SERVICE_FOOTER_MARKERS = [
  'Generated by qa-ai-tool',
  'Source work item',
  'Needs QA review',
]

function PartialFieldWarning() {
  return (
    <span className="partial-field-missing">
      <AlertTriangle size={11} />
      not processed
    </span>
  )
}

function TestCaseView({ tc, partialFields }: { tc: TestCase; partialFields?: Set<string> }) {
  const priority = tc.priority
  const priorityLabel = priority ? (PRIORITY_LABELS[priority] ?? priority) : null
  const priorityKey = (priority ?? '').toLowerCase()
  const statusLabel = tc.status ? (STATUS_LABELS[tc.status] ?? tc.status) : null
  const priorityDotClass =
    priorityKey === 'highest' || priorityKey === 'high' ? 'pdot-high' :
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
    { label: 'Section', value: tc.section_name ?? '—' },
    { label: 'Duration', value: dur ?? '—' },
    { label: 'ID', value: globalId != null ? String(globalId) : '—' },
    { label: 'Version', value: versionNumber != null ? String(versionNumber) : '—' },
  ]
  // Optional: Author only when present in attributes
  const author = tc.attributes?.['Author'] ?? tc.attributes?.['Автор'] ?? tc.attributes?.['author'] ?? tc.attributes?.['createdBy']
  if (author != null) metaItems.push({ label: 'Author', value: String(author) })
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
          <span className="case-sec-label">Metadata</span>
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
        const sourceMatch = allTags.map(t => t.match(SOURCE_TAG_RE)).find(Boolean)
        const sourceId = sourceMatch?.[1]
        const withoutSource = allTags.filter(t => !SOURCE_TAG_RE.test(t))
        const regularTags = withoutSource
        const hasAny = regularTags.length > 0

        return (
          <div>
            <span className="case-sec-label">Tags</span>
            {sourceId && (
              <div className="source-id-badge">
                Source case: <span style={{ color: 'var(--accent)' }}>#{sourceId}</span>
              </div>
            )}
            {hasAny ? (
              <div className="tag-chips">
                {regularTags.map(tag => (
                  <span key={tag} className={`tag-chip${WARN_TAGS.has(tag) ? ' tag-chip-warn' : ''}`}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="case-text-box case-text-empty">not specified</div>
            )}
          </div>
        )
      })()}

      {/* Linked issues / requirements — always show */}
      <div>
        <span className="case-sec-label">Related issues</span>
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
                  {LINK_TYPE_LABELS[link.type ?? ''] ?? link.type ?? 'Link'}
                </span>
                <span className="link-label">{linkLabel(link)}</span>
                <ExternalLink size={11} className="link-ext-icon" />
              </a>
            ))}
          </div>
        ) : (
          <div className="case-text-box case-text-empty">not specified</div>
        )}
      </div>

      {/* Description — always show */}
      <div>
        <span className="case-sec-label">Description</span>
        {tc.description?.trim()
          ? <div className="case-text-box" style={{ whiteSpace: 'pre-line' }}>{tc.description.trim()}</div>
          : partialFields?.has('description')
            ? <div className="case-text-box case-text-empty"><PartialFieldWarning /></div>
            : <div className="case-text-box case-text-empty">not specified</div>
        }
      </div>

      {/* Attachments — show list when any exist */}
      {(tc.attachments?.length ?? 0) > 0 && (
        <div>
          <span className="case-sec-label">Attachments</span>
          <div className="links-list">
            {tc.attachments!.map((att, i) => (
              att.url
                ? <a key={i} className="link-row" href={att.url} target="_blank" rel="noopener noreferrer">
                    <span className="link-type-badge link-type-default">{att.type ?? 'file'}</span>
                    <span className="link-label">{att.name ?? att.file_id ?? att.url}</span>
                    <ExternalLink size={11} className="link-ext-icon" />
                  </a>
                : <div key={i} className="link-row" style={{ cursor: 'default' }}>
                    <span className="link-type-badge link-type-default">{att.type ?? 'file'}</span>
                    <span className="link-label">{att.name ?? att.file_id ?? '—'}</span>
                  </div>
            ))}
          </div>
        </div>
      )}

      {/* Product versions */}
      {(tc.product_versions?.length ?? 0) > 0 && (
        <div>
          <span className="case-sec-label">Product versions</span>
          <div className="tag-chips">
            {tc.product_versions!.map((v, i) => (
              <span key={i} className="tag-chip" style={{ fontFamily: 'monospace' }}>{v}</span>
            ))}
          </div>
        </div>
      )}

      {/* Preconditions */}
      <StepBlock label="Precondition" steps={tc.preconditions} />

      {/* Steps — always show; warn on missing test_data */}
      <div>
        <span className="case-sec-label">
          Steps
        </span>
        {(tc.steps?.length ?? 0) > 0 ? (
          <StepsTable steps={tc.steps!} warnMissingTestData />
        ) : partialFields?.has('steps') ? (
          <div className="case-text-box case-text-empty"><PartialFieldWarning /></div>
        ) : (
          <div className="case-text-box case-text-empty">not specified</div>
        )}
      </div>

      {/* Postconditions — always shown */}
      <div>
        <span className="case-sec-label">Postcondition</span>
        {hasPost
          ? <StepsTable steps={tc.postconditions!} />
          : <div className="case-text-box case-text-empty">not specified</div>
        }
      </div>

      {/* Parameters table — shown only when data present */}
      {tc.parameter_table && tc.parameter_table.names.length > 0 && (
        <div>
          <span className="case-sec-label">Parameters</span>
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
  return (
    <div className="tc-edit-steps">
      {steps.map((step, i) => (
        <div key={i} className="tc-edit-step-row">
          <div className="tc-edit-step-num">{i + 1}</div>
          <div className="tc-edit-step-fields">
            <AutoTextarea
              className="tc-edit-cell"
              placeholder="Action"
              value={step.action ?? ''}
              onChange={v => onUpdate(i, 'action', v)}
            />
            <AutoTextarea
              className="tc-edit-cell tc-edit-cell-dim"
              placeholder="Expected result"
              value={step.expected ?? ''}
              onChange={v => onUpdate(i, 'expected', v)}
            />
            <AutoTextarea
              className="tc-edit-cell"
              placeholder="Test data"
              value={step.test_data ?? ''}
              onChange={v => onUpdate(i, 'test_data', v)}
            />
            {showComments && (
              <AutoTextarea
                className="tc-edit-cell tc-edit-cell-dim"
                placeholder="Comment"
                value={step.comments ?? ''}
                onChange={v => onUpdate(i, 'comments', v)}
              />
            )}
          </div>
          <button type="button" className="tc-edit-step-del" title="Remove step" onClick={() => onRemove(i)}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="tc-edit-add-step" onClick={onAdd}>
        + Add step
      </button>
    </div>
  )
}

function EditableTestCaseView({ tc, onChange }: { tc: TestCase; onChange: (updated: TestCase) => void }) {
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
        <span className="case-sec-label">Title</span>
        <input
          className="tc-edit-input"
          value={tc.title ?? ''}
          onChange={e => onChange({ ...tc, title: e.target.value })}
        />
      </div>
      <div className="tc-edit-row2">
        <div>
          <span className="case-sec-label">Priority</span>
          <select
            className="tc-edit-input"
            value={tc.priority ?? ''}
            onChange={e => onChange({ ...tc, priority: e.target.value || null })}
          >
            <option value="">— not set —</option>
            <option value="Highest">Highest</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
        <div>
          <span className="case-sec-label">Status</span>
          <select
            className="tc-edit-input"
            value={tc.status ?? ''}
            onChange={e => onChange({ ...tc, status: e.target.value || null })}
          >
            <option value="">— not set —</option>
            <option value="Ready">Ready</option>
            <option value="NotReady">Not ready</option>
            <option value="Draft">Draft</option>
            <option value="NeedsWork">Needs work</option>
            <option value="Obsolete">Obsolete</option>
            <option value="InProgress">In progress</option>
          </select>
        </div>
      </div>
      <div>
        <span className="case-sec-label">Tags</span>
        <div className="tc-edit-tags">
          {(tc.tags ?? []).map(tag => (
            <span key={tag} className="tc-edit-tag">
              {tag}
              <button
                type="button"
                className="tc-edit-tag-del"
                onClick={() => onChange({ ...tc, tags: (tc.tags ?? []).filter(t => t !== tag) })}
              >×</button>
            </span>
          ))}
          <input
            className="tc-edit-tag-input"
            placeholder="+ tag"
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
        <span className="case-sec-label">Duration</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            className="tc-edit-input"
            type="number"
            min={1}
            style={{ width: 80 }}
            value={tc.duration != null ? Math.round(parseInt(tc.duration, 10) / 60000) : ''}
            placeholder="—"
            onChange={e => {
              const mins = parseInt(e.target.value, 10)
              onChange({ ...tc, duration: isNaN(mins) || mins <= 0 ? null : String(mins * 60000) })
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--tx-dim)' }}>min</span>
        </div>
      </div>
      <div>
        <span className="case-sec-label">Description</span>
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
        <span className="case-sec-label">Precondition</span>
        <EditableStepsTable
          steps={tc.preconditions ?? []}
          showComments={false}
          onUpdate={(i, k, v) => updateStep('preconditions', i, k, v)}
          onRemove={i => removeStep('preconditions', i)}
          onAdd={() => addStep('preconditions')}
        />
      </div>
      <div>
        <span className="case-sec-label">Steps</span>
        <EditableStepsTable
          steps={tc.steps ?? []}
          showComments
          onUpdate={(i, k, v) => updateStep('steps', i, k, v)}
          onRemove={i => removeStep('steps', i)}
          onAdd={() => addStep('steps')}
        />
      </div>
      <div>
        <span className="case-sec-label">Postcondition</span>
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
const DIFF_SECTION_LABELS: Record<string, string> = {
  steps: 'Steps', preconditions: 'Preconditions',
  postconditions: 'Postconditions', metadata: 'Metadata',
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

function diffItemLabel(itemKey: string): string {
  const m = itemKey.match(/^(steps|preconditions|postconditions)\.(\d+)$/)
  if (m) {
    const n = parseInt(m[2]) + 1
    if (m[1] === 'steps') return `Step ${n}`
    if (m[1] === 'preconditions') return `Precondition ${n}`
    return `Postcondition ${n}`
  }
  return FIELD_LABELS[itemKey] ?? itemKey
}

function diffSubLabel(field: string): string {
  const m = field.match(/^(?:steps|preconditions|postconditions)\.\d+\.(.+)$/)
  const key = m ? m[1] : field
  return FIELD_LABELS[key] ?? key
}

function DiffView({ changes }: { changes: NonNullable<ImproveResult['diff']>['changes'] }) {
  if (!changes.length) {
    return (
      <div style={{ color: 'var(--tx-dim)', fontSize: 13, padding: '16px 0', textAlign: 'center' }}>
        No changes
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
        <span className="diff-header-title">Change history</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {addedCount   > 0 && <span className="diff-pill diff-pill-add">+{addedCount} added</span>}
          {changedCount > 0 && <span className="diff-pill diff-pill-chg">✎ {changedCount} changed</span>}
          {removedCount > 0 && <span className="diff-pill diff-pill-del">−{removedCount} removed</span>}
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
              <span className="diff-section-label">{DIFF_SECTION_LABELS[sk]}</span>
              {sAdd > 0 && <span className="diff-count diff-count-add">+{sAdd}</span>}
              {sChg > 0 && <span className="diff-count diff-count-chg">{sChg} chg</span>}
              {sDel > 0 && <span className="diff-count diff-count-del">−{sDel}</span>}
            </div>

            {[...items.entries()].map(([ik, fieldChanges]) => {
              const blockLabel = diffItemLabel(ik)
              return (
                <div key={ik} className="diff-block">
                  <div className="diff-block-path">{blockLabel}</div>
                  {fieldChanges.map((change, ci) => {
                    const sub = diffSubLabel(change.field)
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

const ISSUE_TITLE_RU: Record<string, string> = {
  'test_data': 'Test data',
  'steps': 'Steps',
  'preconditions': 'Preconditions',
  'postconditions': 'Postconditions',
  'duration': 'Duration',
  'tags': 'Tags',
  'links': 'Links',
  'title': 'Title',
  'description': 'Description',
  'priority': 'Priority',
  'status': 'Status',
  'expected_result': 'Expected result',
}

function issueTitleRu(title: string): string {
  const key = title.toLowerCase().replace(/\s+/g, '_')
  return ISSUE_TITLE_RU[key] ?? title
}

function parseIssueDescription(description: string): { text: string; evidence: string | null } {
  const match = description.match(/^([\s\S]*?)\s*Example:\s*([\s\S]*)$/i)
  if (!match) return { text: description.trim(), evidence: null }
  return { text: match[1].trim(), evidence: match[2].trim() || null }
}

function IssueRow({ issue, resolution, hasImprovement, onDismiss }: {
  issue: ReviewIssue
  resolution: IssueResolution | undefined
  hasImprovement: boolean
  onDismiss?: () => void
}) {
  const isResolved = resolution?.status === 'resolved'
  const borderClass = isResolved ? 'iborder-resolved' :
    issue.severity === 'high' ? 'iborder-h' :
    issue.severity === 'medium' ? 'iborder-m' : 'iborder-l'
  const { text: description, evidence } = parseIssueDescription(issue.description)
  return (
    <div className={`issue-row ${borderClass}${isResolved ? ' issue-row-resolved' : ''}`}>
      <div className="issue-body">
        <div className="issue-title-text">{issueTitleRu(issue.title)}</div>
        {description && <div className="issue-loc">{description}</div>}
        {evidence && <div className="issue-evidence">{evidence}</div>}
        {resolution?.status === 'manual_needed' && resolution.reason && (
          <div className="issue-reason">{resolution.reason}</div>
        )}
      </div>
      {resolution?.status === 'resolved' && <span className="issue-badge ib-resolved">Resolved</span>}
      {resolution?.status === 'manual_needed' && <span className="issue-badge ib-manual">Manual</span>}
      {resolution?.status === 'skipped' && <span className="issue-badge ib-skipped">Skipped</span>}
      {hasImprovement && !resolution && <span className="issue-badge ib-skipped">Not processed</span>}
      {onDismiss && (
        <button type="button" className="issue-dismiss-btn" onClick={onDismiss} title="Dismiss issue">
          <X size={11} />
        </button>
      )}
    </div>
  )
}

function RailLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--accent)', fontSize: 12, fontWeight: 500 }}>
        <span className="spinner"><Sparkles size={13} /></span>
        Analyzing test case...
      </div>
      {[75, 55, 65, 45, 60].map((w, i) => (
        <div key={i} style={{ height: 11, borderRadius: 4, width: `${w}%` }} className="skel" />
      ))}
    </div>
  )
}

// TODO: fetch from GET /testit/sections once backend endpoint is added
const MOCK_SECTIONS = [
  { id: 'ai-review-drafts', name: 'AI Review / Drafts' },
]

function SectionPickerModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (sectionName: string) => void
  onCancel: () => void
}) {
  const [selectedId, setSelectedId] = useState(MOCK_SECTIONS[0].id)

  return (
    <div className="action-modal-overlay" onClick={onCancel}>
      <div className="action-modal" onClick={e => e.stopPropagation()}>
        <div className="action-modal-header">
          <span className="action-modal-icon"><FolderOpen size={16} strokeWidth={1.75} /></span>
          <span className="action-modal-title">Create draft</span>
        </div>
        <div className="action-modal-body">
          <label className="action-modal-label">Save to section</label>
          <div className="action-modal-options">
            {MOCK_SECTIONS.map(s => (
              <button
                key={s.id}
                type="button"
                className={`action-modal-option${selectedId === s.id ? ' selected' : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                <span className="action-modal-option-radio" />
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="action-modal-footer">
          <button type="button" className="wb-btn wb-btn-sec" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-pri"
            onClick={() => {
              const section = MOCK_SECTIONS.find(s => s.id === selectedId)
              onConfirm(section?.name ?? MOCK_SECTIONS[0].name)
            }}
          >
            <CheckCircle2 size={13} />
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

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
  return (
    <div className="action-modal-overlay" onClick={loading ? undefined : onCancel}>
      <div className="action-modal action-modal-destructive" onClick={e => e.stopPropagation()}>
        <div className="action-modal-header action-modal-header-destructive">
          <span className="action-modal-icon-destructive">
            <AlertTriangle size={18} strokeWidth={1.75} />
          </span>
          <div>
            <div className="action-modal-title">Replace original?</div>
            <div className="action-modal-subtitle">#{workItemId}</div>
          </div>
        </div>
        <div className="action-modal-body">
          The improved version will fully replace the original test case in TestIT.
          <div className="action-modal-warn-text">
            <span className="action-modal-warn-dot" />
            This action cannot be undone
          </div>
        </div>
        <div className="action-modal-footer">
          <button type="button" className="wb-btn wb-btn-sec" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="wb-btn-danger" onClick={onConfirm} disabled={loading}>
            {loading
              ? <><Loader2 size={13} className="spin-icon" /> Applying…</>
              : <><AlertTriangle size={13} /> Replace</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

export function Workbench({ fetchResult, reviewConfig, selectedPreset, enabledRules, onApply, onBack }: Props) {
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null)
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [improveResult, setImproveResult] = useState<ImproveResult | null>(null)
  const [improveLoading, setImproveLoading] = useState(false)
  const [improveError, setImproveError] = useState<string | null>(null)
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftSectionName, setDraftSectionName] = useState<string>(MOCK_SECTIONS[0].name)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
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

  const tc = fetchResult.normalized_testcase

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
      setActiveTab('original')
      try {
        const result = await api.analyzeTestCase({
          work_item: fetchResult.raw_work_item,
          source_type: 'testit',
          enabled_rules: enabledRules,
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function runAnalyze() {
    setAnalyzeLoading(true)
    setAnalyzeError(null)
    setAnalyzeResult(null)
    setImproveResult(null)
    setImproveError(null)
    setDraftResult(null)
    setDismissedIndices(new Set())
    setApplyResult(null)
    setActiveTab('original')
    try {
      const result = await api.analyzeTestCase({
        work_item: fetchResult.raw_work_item,
        source_type: 'testit',
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
    try {
      const enabledLabels = new Set(
        reviewConfig.rules.filter(r => enabledRules.includes(r.id)).map(r => r.label)
      )
      const issuesToFix = analyzeResult.issues.filter((i, idx) =>
        enabledLabels.has(i.title) && !dismissedIndices.has(idx)
      )
      const result = await api.improveTestCase({
        work_item: fetchResult.raw_work_item,
        selected_issues: issuesToFix,
        source_type: 'testit',
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

  async function runCreateDraft(sectionNameOverride?: string) {
    if (!improveResult) return
    const effectiveSectionName = sectionNameOverride ?? draftSectionName
    setDraftLoading(true)
    try {
      const result = await api.createDraft({
        improved_testcase: editedTestCase ?? improveResult.improved_testcase,
        source_work_item_id: fetchResult.work_item_id,
        source_attributes: (fetchResult.raw_work_item.attributes ?? {}) as Record<string, unknown>,
        manual_notes: improveResult.manual_notes ?? [],
      })
      setDraftResult(result)
    } catch {
      // TODO: show error
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

  // Reconstruct the same filter used in runImprove so resolution indices match.
  // Backend numbers issues 0..N from selected_issues, not from analyzeResult.issues.
  const _enabledLabels = new Set(
    reviewConfig.rules.filter(r => enabledRules.includes(r.id)).map(r => r.label)
  )
  const selectedIssuesForImprove = (analyzeResult?.issues ?? []).filter((i, idx) =>
    _enabledLabels.has(i.title) && !dismissedIndices.has(idx)
  )

  function getResolution(issue: ReviewIssue): IssueResolution | undefined {
    const selectedIdx = selectedIssuesForImprove.indexOf(issue)
    if (selectedIdx === -1) return undefined
    return improveResult?.issue_resolutions?.find(r => r.issue_index === selectedIdx)
  }

  const unresolvedIssues = analyzeResult?.issues.filter(issue => {
    const selectedIdx = selectedIssuesForImprove.indexOf(issue)
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

  function scoreBadge(s: number) {
    if (s >= 85) return 'Excellent'
    if (s >= 70) return 'Good'
    if (s >= 50) return 'Fair'
    return 'Poor'
  }

  const hasImprove = !!improveResult
  const hasDraft = !!draftResult

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
  function computeImproveStatus(r: ImproveResult): 'success' | 'partial' {
    if ((r.manual_notes?.length ?? 0) > 0) return 'partial'
    if ((r.validation_warnings?.length ?? 0) > 0) return 'partial'
    if (!r.improved_testcase.title?.trim()) return 'partial'
    if (!r.improved_testcase.steps?.length) return 'partial'
    const desc = r.improved_testcase.description ?? ''
    const origDesc = String((r.original_normalized_testcase as Record<string, unknown>)?.description ?? '')
    if (SERVICE_FOOTER_MARKERS.some(m => desc.includes(m) && !origDesc.includes(m))) return 'partial'
    return 'success'
  }

  // Humanize improve errors for display
  function humanizeImproveError(msg: string): string {
    const m = msg.toLowerCase()
    if (m.includes('timeout') || m.includes('timed out')) return 'AI response timed out'
    if (m.includes('500') || m.includes('internal')) return 'Internal AI server error'
    if (m.includes('429') || m.includes('rate')) return 'Too many requests — try again later'
    if (m.includes('503') || m.includes('unavailable')) return 'AI service temporarily unavailable'
    return 'Request processing error'
  }

  const improveStatus: 'success' | 'partial' | 'error' | null = improveError
    ? 'error'
    : improveResult
    ? computeImproveStatus(improveResult)
    : null

  const openCriticalCount = analyzeResult?.issues.filter((issue, absIdx) => {
    if (issue.severity !== 'high') return false
    if (dismissedIndices.has(absIdx)) return false
    const selectedIdx = selectedIssuesForImprove.indexOf(issue)
    if (selectedIdx === -1) return true
    return !improveResult?.issue_resolutions?.some(r => r.issue_index === selectedIdx && r.status === 'resolved')
  }).length ?? 0

  const canDraft = (improveStatus === 'success' || improveStatus === 'partial') && !applyResult
  const canApply = improveStatus === 'success' && openCriticalCount === 0 && manualCount === 0 && !applyResult
  const applyBlockReason = improveStatus === 'partial'
    ? 'Case partially improved, manual review needed'
    : openCriticalCount > 0 && manualCount > 0
      ? `Unresolved critical issues (${openCriticalCount}) and requiring manual fix (${manualCount})`
      : openCriticalCount > 0
        ? `Unresolved critical issues: ${openCriticalCount}`
        : manualCount > 0
          ? `${manualCount} ${manualCount === 1 ? 'issue requires' : 'issues require'} manual fix in TestIT`
          : null

  // Fields empty in improved result when AI partially processed — shown as ⚠ не обработано
  const partialFields = new Set<string>()
  if (improveStatus === 'partial' && improveResult) {
    const it = improveResult.improved_testcase
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
    { id: 'original' as const, label: 'Original', disabled: false, count: null },
    { id: 'improved' as const, label: 'Improved', disabled: !improvedTabAccessible,
      count: improveStatus === 'success' ? '✓' : improveStatus === 'partial' ? '!' : improveStatus === 'error' ? '✕' : null },
    { id: 'diff' as const, label: 'Changes', disabled: !hasImprove, count: diffCount ? String(diffCount) : null },
    { id: 'json' as const, label: 'JSON', disabled: false, count: null },
  ]

  const isLoading = analyzeLoading || improveLoading || draftLoading
  const bannerNotifications: ActionNotification[] = [
    ...(draftResult ? [{
      type: 'draft' as const,
      id: draftResult.global_id != null ? String(draftResult.global_id) : draftResult.work_item_id,
      testit_url: draftResult.testit_url,
      sectionName: draftSectionName,
      isPartial: improveStatus === 'partial' || manualCount > 0,
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
        title="Review & Improve test cases"
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
                Analyzing...
              </span>
            )}
            {analyzeResult && !improveStatus && (
              <span className="wb-status-analyzed">
                <Sparkles size={12} />
                {analyzeResult.issues.length} issues
              </span>
            )}
            {improveStatus === 'success' && (
              <span className="wb-status-ok">
                <CheckCircle2 size={13} />
                Improved
              </span>
            )}
            {improveStatus === 'partial' && (
              <span className="wb-status-partial">
                <AlertTriangle size={13} />
                Needs review
              </span>
            )}
            {improveStatus === 'error' && (
              <span className="wb-status-err">
                <AlertTriangle size={13} />
                Improve error
              </span>
            )}
            {improveStatus === 'success' && resolvedCount > 0 && (
              <span className="wb-metric wb-metric-ok">
                <Check size={11} strokeWidth={2.5} />
                {resolvedCount} resolved
              </span>
            )}
            {improveStatus && improveStatus !== 'error' && manualCount > 0 && (
              <span className="wb-metric wb-metric-warn">
                <AlertTriangle size={11} />
                {manualCount} manual
              </span>
            )}
          </div>
        </div>
        <div className="wb-actions">
          {/* Initial loading — no prior result yet */}
          {analyzeLoading && !analyzeResult && (
            <button type="button" className="wb-btn wb-btn-sec" disabled>
              <span className="spinner" style={{ display: 'inline-flex' }}><Sparkles size={13} /></span>
              Analyzing...
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
              Re-run review
            </button>
          )}
          {/* Improve / retry */}
          {analyzeResult && (
            improveLoading ? (
              <button type="button" className="wb-btn wb-btn-sec" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><Wand2 size={13} /></span>
                Improving...
              </button>
            ) : improveStatus === 'error' ? (
              <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                <RotateCcw size={13} />
                Retry
              </button>
            ) : hasImprove ? (
              <button type="button" className="wb-btn wb-btn-sec" onClick={runImprove}
                disabled={improveLoading || analyzeLoading}>
                <Wand2 size={13} />
                Improve again
              </button>
            ) : (
              <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                <Wand2 size={13} />
                Improve
              </button>
            )
          )}
          {/* Draft */}
          {improvedTabAccessible && improveStatus !== 'error' && (
            hasDraft ? (
              <button type="button" className="wb-btn wb-btn-done" disabled>
                <CheckCircle2 size={13} />
                Draft created
              </button>
            ) : draftLoading ? (
              <button type="button" className="wb-btn wb-btn-sec" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><CheckCircle2 size={13} /></span>
                Creating...
              </button>
            ) : canDraft ? (
              <button
                type="button"
                className={`wb-btn ${improveStatus === 'partial' ? 'wb-btn-sec-warn' : 'wb-btn-sec'}`}
                title={improveStatus === 'partial' ? 'Case partially improved, manual review recommended' : undefined}
                onClick={() => setShowSectionPicker(true)}
              >
                <CheckCircle2 size={13} />
                Create draft
              </button>
            ) : null
          )}
          {/* Apply to original */}
          {improvedTabAccessible && improveStatus !== 'error' && (
            hasApply ? (
              <button type="button" className="wb-btn wb-btn-done" disabled>
                <CheckCircle2 size={13} />
                Applied
              </button>
            ) : applyLoading ? (
              <button type="button" className="wb-btn-apply" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><Wand2 size={13} /></span>
                Applying...
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
                  Apply to original
                </button>
                {!canApply && applyBlockReason && (
                  <span className="wb-btn-tip">{applyBlockReason}</span>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* Section picker modal */}
      {showSectionPicker && (
        <SectionPickerModal
          onConfirm={(sectionName) => {
            setDraftSectionName(sectionName)
            setShowSectionPicker(false)
            runCreateDraft(sectionName)
          }}
          onCancel={() => setShowSectionPicker(false)}
        />
      )}

      {/* Confirm apply modal */}
      {showConfirmApply && (
        <ConfirmApplyModal
          workItemId={fetchResult.work_item_id}
          loading={applyLoading}
          onConfirm={runApplyToOriginal}
          onCancel={() => setShowConfirmApply(false)}
        />
      )}

      {/* Apply error */}
      {applyError && (
        <div className="alert alert-error" style={{ margin: '0 0 8px' }}>
          <span className="alert-text">Apply error: {applyError}</span>
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
            {activeTab === 'improved' && hasImprove && (
              <button
                type="button"
                className={`tc-edit-toggle${isEditing ? ' tc-edit-toggle-active' : ''}`}
                style={{ marginLeft: 'auto', alignSelf: 'center' }}
                onClick={() => setIsEditing(v => !v)}
              >
                <Wrench size={11} />
                {isEditing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
          <div className="wb-content">
            {activeTab === 'original' && <TestCaseView tc={tc} />}
            {activeTab === 'improved' && improveStatus === 'error' && (
              <div className="improve-error-block">
                <AlertTriangle size={24} className="improve-error-icon" />
                <div className="improve-error-body">
                  <div className="improve-error-title">Failed to improve</div>
                  <div className="improve-error-msg">{humanizeImproveError(improveError ?? '')}</div>
                </div>
                <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                  <RotateCcw size={13} />
                  Retry
                </button>
              </div>
            )}
            {activeTab === 'improved' && improveStatus === 'partial' && mergedEdited && (
              <>
                <div className="improve-partial-banner">
                  <AlertTriangle size={14} />
                  <div>
                    <span>Improvement partially completed. Some fields require review.</span>
                    {(improveResult?.validation_warnings?.length ?? 0) > 0 && (
                      <span className="improve-partial-detail">
                        {improveResult!.validation_warnings!.join('; ')}
                      </span>
                    )}
                  </div>
                </div>
                {isEditing && editedTestCase
                  ? <EditableTestCaseView tc={editedTestCase} onChange={setEditedTestCase} />
                  : <TestCaseView tc={mergedEdited} partialFields={partialFields} />
                }
              </>
            )}
            {activeTab === 'improved' && improveStatus === 'success' && mergedEdited && (
              isEditing && editedTestCase
                ? <EditableTestCaseView tc={editedTestCase} onChange={setEditedTestCase} />
                : <TestCaseView tc={mergedEdited} />
            )}
            {activeTab === 'diff' && (
              <DiffView changes={improveResult?.diff?.changes ?? []} />
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
            <span className="rail-title">AI Review</span>
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
              <>
                {/* Score card */}
                {score !== null && (
                  <div className="score-card">
                    <div className="score-head">Quality score</div>
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
                        <span className="score-badge score-good">{scoreBadge(score)}</span>
                        <div className="score-ctrs">
                          {hasImprove && resolvedCount > 0 && (
                            <span className="score-ctr sctr-ok">
                              <Check size={11} strokeWidth={2.5} />{resolvedCount} resolved
                            </span>
                          )}
                          {hasImprove && manualCount > 0 && (
                            <span className="score-ctr sctr-warn">
                              <AlertTriangle size={11} />{manualCount} manual
                            </span>
                          )}
                          {!hasImprove && (
                            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>
                              {analyzeResult.issues.length} issues
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
                    AI Review
                  </div>
                  <div className="ai-text">{analyzeResult.summary}</div>
                </div>

                {/* Manual work banner — top priority, shown first */}
                {hasImprove && (improveResult!.manual_notes?.length ?? 0) > 0 && (
                  <div className="manual-banner">
                    <div className="mb-head">
                      <Wrench size={13} />
                      Requires manual work
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
                    <div className="issues-section-label isl-high">Critical · {highIssues.length}</div>
                    {highIssues.map(({ issue, idx }) => (
                      <IssueRow key={idx} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove}
                        onDismiss={() => setDismissedIndices(prev => new Set([...prev, idx]))} />
                    ))}
                  </div>
                )}
                {medIssues.length > 0 && (
                  <div>
                    <div className="issues-section-label isl-medium">Medium · {medIssues.length}</div>
                    {medIssues.map(({ issue, idx }) => (
                      <IssueRow key={idx} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove}
                        onDismiss={() => setDismissedIndices(prev => new Set([...prev, idx]))} />
                    ))}
                  </div>
                )}
                {lowIssues.length > 0 && (
                  <div>
                    <div className="issues-section-label isl-low">Low · {lowIssues.length}</div>
                    {lowIssues.map(({ issue, idx }) => (
                      <IssueRow key={idx} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove}
                        onDismiss={() => setDismissedIndices(prev => new Set([...prev, idx]))} />
                    ))}
                  </div>
                )}

                {/* Resolved issues — collapsed group at the bottom */}
                {resolvedVisible.length > 0 && (
                  <div className="resolved-section">
                    <button type="button" className="resolved-toggle" onClick={() => setShowResolved(v => !v)}>
                      <Check size={11} strokeWidth={2.5} />
                      Resolved
                      <span className="resolved-toggle-count">{resolvedVisible.length}</span>
                      <span className="resolved-toggle-hint">{showResolved ? '▲' : '▼'}</span>
                    </button>
                    {showResolved && resolvedVisible.map(({ issue, idx }) => (
                      <IssueRow key={idx} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove}
                        onDismiss={() => setDismissedIndices(prev => new Set([...prev, idx]))} />
                    ))}
                  </div>
                )}

                {dismissedIssuesList.length > 0 && (
                  <div className="dismissed-section">
                    <button type="button" className="dismissed-toggle" onClick={() => setShowDismissed(v => !v)}>
                      <EyeOff size={11} />
                      Excluded · {dismissedIssuesList.length}
                      <span className="dismissed-toggle-hint">{showDismissed ? '▲' : '▼'}</span>
                    </button>
                    {showDismissed && dismissedIssuesList.map(({ issue, idx }) => (
                      <div key={idx} className="issue-row iborder-resolved issue-row-dismissed">
                        <div className="issue-body">
                          <div className="issue-title-text issue-title-dismissed">{issueTitleRu(issue.title)}</div>
                        </div>
                        <button type="button" className="issue-restore-btn"
                          onClick={() => setDismissedIndices(prev => { const s = new Set(prev); s.delete(idx); return s })}
                          title="Restore">
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {analyzeResult.issues.length === 0 && (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--tx-muted)', fontSize: 13 }}>
                    No issues found
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

              </>
            )}
          </div>
        </div>
      </div>
    </div>
</>
  )
}
