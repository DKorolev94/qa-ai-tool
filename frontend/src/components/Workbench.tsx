import { useEffect, useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2,
  ChevronLeft, ExternalLink, FolderOpen, Link2, Paperclip, RotateCcw, Sparkles, Wand2, Wrench,
} from 'lucide-react'
import { api } from '../api'
import { ModeButton } from './ModeButton'
import { ProgressBar } from './ProgressBar'
import type {
  AnalyzeResult, ApplyResult, DraftResult, FetchResult, ImproveResult,
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
  High: 'Высокий', Medium: 'Средний', Low: 'Низкий',
  high: 'Высокий', medium: 'Средний', low: 'Низкий',
}

// TestIT returns status values in English; map to Russian and badge class
const STATUS_LABELS: Record<string, string> = {
  Ready: 'Готов',
  NotReady: 'Не готов',
  Draft: 'Черновик',
  NeedsWork: 'Требует доработки',
  Obsolete: 'Устарел',
  InProgress: 'В работе',
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
  title: 'Название', description: 'Описание',
  preconditions: 'Предусловие', postconditions: 'Постусловие',
  tags: 'Теги', priority: 'Приоритет', status: 'Статус', duration: 'Длительность',
  expected: 'Ожидаемый результат', action: 'Действие', test_data: 'Тестовые данные',
}

function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  const m = field.match(/^steps\.(\d+)\.(.+)$/)
  if (m) return `Шаг ${parseInt(m[1]) + 1} — ${FIELD_LABELS[m[2]] ?? m[2]}`
  const p = field.match(/^preconditions\.(\d+)\.(.+)$/)
  if (p) return `Предусловие ${parseInt(p[1]) + 1} — ${FIELD_LABELS[p[2]] ?? p[2]}`
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
  const showComments = true
  const cols = [
    '28px', '1fr', '1fr',
    ...(showTestData ? ['1fr'] : []),
    ...(showComments ? ['minmax(80px,0.5fr)'] : []),
  ].join(' ')

  return (
    <div className="steps-tbl">
      <div className="steps-head" style={{ gridTemplateColumns: cols }}>
        <div className="steps-th steps-th-num">#</div>
        <div className="steps-th">Действие</div>
        <div className="steps-th">Ожидаемый результат</div>
        {showTestData && <div className="steps-th">Тестовые данные</div>}
        {showComments && <div className="steps-th">Комментарии</div>}
      </div>
      {steps.map((step, i) => (
        <div key={i} className="steps-row" style={{ gridTemplateColumns: cols }}>
          <div className="steps-num-cell">{i + 1}</div>
          <div className="steps-cell steps-action">{renderWithParams(step.action)}</div>
          <div className="steps-cell steps-exp">
            {step.expected ? step.expected : <span className="steps-empty">—</span>}
          </div>
          {showTestData && (
            <div className="steps-cell steps-td-col">
              {step.test_data
                ? <span className="steps-td-mono">{step.test_data}</span>
                : <span className="steps-empty">—</span>
              }
            </div>
          )}
          {showComments && (
            <div className="steps-cell steps-cm-col">
              {step.comments ?? <span className="steps-empty">—</span>}
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
  Issue: 'Задача', Defect: 'Дефект', Requirement: 'Требование',
  BlockedBy: 'Блокирует', Related: 'Связано', Clones: 'Клон',
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
      не обработано
    </span>
  )
}

function TestCaseView({ tc, partialFields }: { tc: TestCase; partialFields?: Set<string> }) {
  const priority = tc.priority
  const priorityLabel = priority ? (PRIORITY_LABELS[priority] ?? priority) : null
  const priorityKey = (priority ?? '').toLowerCase()
  const statusLabel = tc.status ? (STATUS_LABELS[tc.status] ?? tc.status) : null
  const priorityPill =
    priorityKey === 'high' ? 'pill-high' :
    priorityKey === 'medium' ? 'pill-warn' :
    priorityKey === 'low' ? 'pill-low' : 'pill-neutral'
  const statusPill = tc.status ? (STATUS_PILL[tc.status] ?? 'pill-neutral') : 'pill-neutral'

  // TODO: attachments_count from tc.attributes once TestIT mapper populates it
  const attachmentsCount = Number(tc.attributes?.['attachments_count'] ?? 0)

  // Metadata grid — always 4 cards; '—' when absent
  // TODO: globalId / versionNumber from tc.attributes once TestIT mapper populates them
  const dur = tc.display_duration ?? (tc.duration != null ? String(tc.duration) : null)
  const globalId = tc.attributes?.['globalId']
  const versionNumber = tc.attributes?.['versionNumber']
  const metaItems: Array<{ label: string; value: string }> = [
    { label: 'Секция', value: tc.section_name ?? '—' },
    { label: 'Длительность', value: dur ?? '—' },
    { label: 'ID', value: globalId != null ? String(globalId) : '—' },
    { label: 'Версия', value: versionNumber != null ? String(versionNumber) : '—' },
  ]
  // Optional: Автор only when present in attributes
  const author = tc.attributes?.['Автор'] ?? tc.attributes?.['author'] ?? tc.attributes?.['createdBy']
  if (author != null) metaItems.push({ label: 'Автор', value: String(author) })
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
            <span className={`case-pill ${priorityPill}`}>
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
          <span className="case-sec-label">Метаданные</span>
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
        const regularTags = withoutSource.filter(t => !SERVICE_TAGS.has(t))
        const serviceTags = withoutSource.filter(t => SERVICE_TAGS.has(t))
        const hasAny = regularTags.length > 0 || serviceTags.length > 0

        return (
          <div>
            <span className="case-sec-label">Теги</span>
            {sourceId && (
              <div className="source-id-badge">
                Исходный кейс: <span style={{ color: 'var(--accent)' }}>#{sourceId}</span>
              </div>
            )}
            {hasAny ? (
              <>
                {regularTags.length > 0 && (
                  <div className="tag-chips">
                    {regularTags.map(tag => (
                      <span key={tag} className={`tag-chip${WARN_TAGS.has(tag) ? ' tag-chip-warn' : ''}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {serviceTags.length > 0 && (
                  <div className="tag-service-group">
                    <span className="tag-service-label">Служебные</span>
                    <div className="tag-chips">
                      {serviceTags.map(tag => (
                        <span key={tag} className="tag-chip-service">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="case-text-box case-text-empty">не указано</div>
            )}
          </div>
        )
      })()}

      {/* Linked issues / requirements — always show */}
      <div>
        <span className="case-sec-label">Связанные задачи</span>
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
                  {LINK_TYPE_LABELS[link.type ?? ''] ?? link.type ?? 'Ссылка'}
                </span>
                <span className="link-label">{linkLabel(link)}</span>
                <ExternalLink size={11} className="link-ext-icon" />
              </a>
            ))}
          </div>
        ) : (
          <div className="case-text-box case-text-empty">не указано</div>
        )}
      </div>

      {/* Description — always show */}
      <div>
        <span className="case-sec-label">Описание</span>
        {tc.description?.trim()
          ? <div className="case-text-box" style={{ whiteSpace: 'pre-line' }}>{tc.description.trim()}</div>
          : partialFields?.has('description')
            ? <div className="case-text-box case-text-empty"><PartialFieldWarning /></div>
            : <div className="case-text-box case-text-empty">не указано</div>
        }
      </div>

      {/* Attachments — show list when any exist */}
      {(tc.attachments?.length ?? 0) > 0 && (
        <div>
          <span className="case-sec-label">Вложения</span>
          <div className="links-list">
            {tc.attachments!.map((att, i) => (
              att.url
                ? <a key={i} className="link-row" href={att.url} target="_blank" rel="noopener noreferrer">
                    <span className="link-type-badge link-type-default">{att.type ?? 'файл'}</span>
                    <span className="link-label">{att.name ?? att.file_id ?? att.url}</span>
                    <ExternalLink size={11} className="link-ext-icon" />
                  </a>
                : <div key={i} className="link-row" style={{ cursor: 'default' }}>
                    <span className="link-type-badge link-type-default">{att.type ?? 'файл'}</span>
                    <span className="link-label">{att.name ?? att.file_id ?? '—'}</span>
                  </div>
            ))}
          </div>
        </div>
      )}

      {/* Product versions */}
      {(tc.product_versions?.length ?? 0) > 0 && (
        <div>
          <span className="case-sec-label">Версии продукта</span>
          <div className="tag-chips">
            {tc.product_versions!.map((v, i) => (
              <span key={i} className="tag-chip" style={{ fontFamily: 'monospace' }}>{v}</span>
            ))}
          </div>
        </div>
      )}

      {/* Preconditions */}
      <StepBlock label="Предусловие" steps={tc.preconditions} warnMissingTestData />

      {/* Steps — always show; warn on missing test_data */}
      <div>
        <span className="case-sec-label">
          Шаги{(tc.steps?.length ?? 0) > 0 && (
            <span style={{ fontFamily: 'monospace', color: 'var(--tx-dim)', fontWeight: 400 }}>
              {' '}{tc.steps!.length}
            </span>
          )}
        </span>
        {(tc.steps?.length ?? 0) > 0 ? (
          <StepsTable steps={tc.steps!} warnMissingTestData />
        ) : partialFields?.has('steps') ? (
          <div className="case-text-box case-text-empty"><PartialFieldWarning /></div>
        ) : (
          <div className="case-text-box case-text-empty">не указано</div>
        )}
      </div>

      {/* Postconditions — always shown */}
      <div>
        <span className="case-sec-label">Постусловие</span>
        {hasPost
          ? <StepsTable steps={tc.postconditions!} />
          : <div className="case-text-box case-text-empty">не указано</div>
        }
      </div>

      {/* Parameters table — shown only when data present */}
      {tc.parameter_table && tc.parameter_table.names.length > 0 && (
        <div>
          <span className="case-sec-label">Параметры</span>
          <ParamTableView table={tc.parameter_table} />
        </div>
      )}
    </>
  )
}

const DIFF_SECTION_ORDER = ['steps', 'preconditions', 'postconditions', 'metadata'] as const
const DIFF_SECTION_LABELS: Record<string, string> = {
  steps: 'Шаги', preconditions: 'Предусловия',
  postconditions: 'Постусловия', metadata: 'Метаданные',
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
    if (m[1] === 'steps') return `Шаг ${n}`
    if (m[1] === 'preconditions') return `Предусловие ${n}`
    return `Постусловие ${n}`
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
        Нет изменений
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
        <span className="diff-header-title">История изменений</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {addedCount   > 0 && <span className="diff-pill diff-pill-add">+{addedCount} добавлено</span>}
          {changedCount > 0 && <span className="diff-pill diff-pill-chg">✎ {changedCount} изменено</span>}
          {removedCount > 0 && <span className="diff-pill diff-pill-del">−{removedCount} удалено</span>}
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
              {sChg > 0 && <span className="diff-count diff-count-chg">{sChg} изм</span>}
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

function IssueRow({ issue, resolution, hasImprovement }: {
  issue: ReviewIssue
  resolution: IssueResolution | undefined
  hasImprovement: boolean
}) {
  const dotClass = issue.severity === 'high' ? 'idot-h' : issue.severity === 'medium' ? 'idot-m' : 'idot-l'
  return (
    <div className="issue-row">
      <div className={`issue-dot ${dotClass}`} />
      <div className="issue-body">
        <div className="issue-title-text">{issue.title}</div>
        {issue.description && <div className="issue-loc">{issue.description}</div>}
      </div>
      {resolution?.status === 'resolved' && <span className="issue-badge ib-resolved">Решено</span>}
      {resolution?.status === 'manual_needed' && <span className="issue-badge ib-manual">Вручную</span>}
      {resolution?.status === 'skipped' && <span className="issue-badge ib-skipped">Пропущено</span>}
      {hasImprovement && !resolution && <span className="issue-badge ib-skipped">Не обработано</span>}
    </div>
  )
}

function RailLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--accent)', fontSize: 12, fontWeight: 500 }}>
        <span className="spinner"><Sparkles size={13} /></span>
        Анализирую тест-кейс...
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
  { id: 'drafts', name: 'Черновики' },
  { id: 'ai-workspace', name: 'AI Workspace' },
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
          <span className="action-modal-title">Создать черновик</span>
        </div>
        <div className="action-modal-body">
          <label className="action-modal-label">Сохранить в</label>
          <select
            className="action-modal-select"
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
          >
            {MOCK_SECTIONS.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="action-modal-footer">
          <button type="button" className="wb-btn wb-btn-sec" onClick={onCancel}>
            Отмена
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
            Создать
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmApplyModal({
  workItemId,
  onConfirm,
  onCancel,
}: {
  workItemId: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="action-modal-overlay" onClick={onCancel}>
      <div className="action-modal" onClick={e => e.stopPropagation()}>
        <div className="action-modal-header">
          <span className="action-modal-icon action-modal-icon-warn">
            <AlertTriangle size={16} strokeWidth={1.75} />
          </span>
          <span className="action-modal-title">Заменить оригинал #{workItemId}?</span>
        </div>
        <div className="action-modal-body">
          Улучшенная версия заменит исходный тест-кейс.
          <div className="action-modal-warn-text">Действие необратимо.</div>
        </div>
        <div className="action-modal-footer">
          <button type="button" className="wb-btn wb-btn-sec" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="wb-btn-danger" onClick={onConfirm}>
            <AlertTriangle size={13} />
            Заменить
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
    try {
      const result = await api.improveTestCase({
        work_item: fetchResult.raw_work_item,
        selected_issues: analyzeResult.issues,
        source_type: 'testit',
        enabled_rules: enabledRules,
      })
      setImproveResult(result)
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
    try {
      const result = await api.createDraft({
        improved_testcase: improveResult.improved_testcase,
        source_work_item_id: fetchResult.work_item_id,
        source_attributes: fetchResult.raw_work_item,
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
        improved_testcase: improveResult.improved_testcase,
        source_work_item_id: fetchResult.work_item_id,
        source_attributes: fetchResult.raw_work_item,
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
    return improveResult?.issue_resolutions?.find(r => r.issue_title === issue.title)
  }

  const score = analyzeResult ? computeScore(analyzeResult.issues) : null
  const R = 22
  const CIRC = 2 * Math.PI * R
  const scoreArc = score !== null ? (score / 100) * CIRC : 0

  const highIssues = analyzeResult?.issues.filter(i => i.severity === 'high') ?? []
  const medIssues = analyzeResult?.issues.filter(i => i.severity === 'medium') ?? []
  const lowIssues = analyzeResult?.issues.filter(i => i.severity === 'low') ?? []

  const resolvedCount = improveResult?.issue_resolutions?.filter(r => r.status === 'resolved').length ?? 0
  const manualCount = improveResult?.issue_resolutions?.filter(r => r.status === 'manual_needed').length ?? 0

  function scoreBadge(s: number) {
    if (s >= 85) return 'Отлично'
    if (s >= 70) return 'Хорошо'
    if (s >= 50) return 'Удовл.'
    return 'Слабо'
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
    if ((r.validation_warnings?.length ?? 0) > 0) return 'partial'
    if (!r.improved_testcase.title?.trim()) return 'partial'
    if (!r.improved_testcase.steps?.length) return 'partial'
    const desc = r.improved_testcase.description ?? ''
    if (SERVICE_FOOTER_MARKERS.some(m => desc.includes(m))) return 'partial'
    return 'success'
  }

  // Humanize improve errors for display
  function humanizeImproveError(msg: string): string {
    const m = msg.toLowerCase()
    if (m.includes('timeout') || m.includes('timed out')) return 'Превышено время ожидания ответа AI'
    if (m.includes('500') || m.includes('internal')) return 'Внутренняя ошибка сервера AI'
    if (m.includes('429') || m.includes('rate')) return 'Слишком много запросов — попробуйте позже'
    if (m.includes('503') || m.includes('unavailable')) return 'AI-сервис временно недоступен'
    return 'Ошибка обработки запроса'
  }

  const improveStatus: 'success' | 'partial' | 'error' | null = improveError
    ? 'error'
    : improveResult
    ? computeImproveStatus(improveResult)
    : null

  const openCriticalCount = analyzeResult?.issues.filter(i =>
    i.severity === 'high' &&
    !improveResult?.issue_resolutions?.some(
      r => r.issue_title === i.title && r.status === 'resolved'
    )
  ).length ?? 0

  const canDraft = (improveStatus === 'success' || improveStatus === 'partial') && !applyResult
  const canApply = improveStatus === 'success' && openCriticalCount === 0 && manualCount === 0 && !applyResult
  const applyBlockReason = improveStatus === 'partial'
    ? 'Кейс требует доработки'
    : (openCriticalCount > 0 || manualCount > 0)
      ? 'Сначала закройте критичные замечания'
      : null

  // Fields empty in improved result when AI partially processed — shown as ⚠ не обработано
  const partialFields = new Set<string>()
  if (improveStatus === 'partial' && improveResult) {
    const it = improveResult.improved_testcase
    if (!it.title?.trim()) partialFields.add('title')
    if (!it.description?.trim()) partialFields.add('description')
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

  const improvedTabAccessible = hasImprove || !!improveError
  const tabs = [
    { id: 'original' as const, label: 'Оригинал', disabled: false, count: null },
    { id: 'improved' as const, label: 'Улучшенный', disabled: !improvedTabAccessible,
      count: improveStatus === 'success' ? '✓' : improveStatus === 'partial' ? '!' : improveStatus === 'error' ? '✕' : null },
    { id: 'diff' as const, label: 'Diff', disabled: !hasImprove, count: diffCount ? String(diffCount) : null },
    { id: 'json' as const, label: 'JSON', disabled: false, count: null },
  ]

  const isLoading = analyzeLoading || improveLoading || draftLoading

  return (
    <>
      <ProgressBar active={isLoading} />
    <div className="workspace-inner-wb">

      {/* Page header */}
      <div className="page-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="back-btn" title="Назад" onClick={onBack}>
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <h1 className="page-title">Ревью и улучшение тест-кейсов</h1>
        </div>
        <ModeButton
          reviewConfig={reviewConfig}
          selectedPreset={selectedPreset}
          enabledRules={enabledRules}
          onApply={onApply}
        />
      </div>

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
                Анализируется...
              </span>
            )}
            {analyzeResult && !improveStatus && (
              <span className="wb-status-analyzed">
                <Sparkles size={12} />
                {analyzeResult.issues.length} замечаний
              </span>
            )}
            {improveStatus === 'success' && (
              <span className="wb-status-ok">
                <CheckCircle2 size={13} />
                Улучшен
              </span>
            )}
            {improveStatus === 'partial' && (
              <span className="wb-status-partial">
                <AlertTriangle size={13} />
                Требует доработки
              </span>
            )}
            {improveStatus === 'error' && (
              <span className="wb-status-err">
                <AlertTriangle size={13} />
                Ошибка улучшения
              </span>
            )}
            {improveStatus === 'success' && resolvedCount > 0 && (
              <span className="wb-metric wb-metric-ok">
                <Check size={11} strokeWidth={2.5} />
                {resolvedCount} решено
              </span>
            )}
            {improveStatus && improveStatus !== 'error' && manualCount > 0 && (
              <span className="wb-metric wb-metric-warn">
                <AlertTriangle size={11} />
                {manualCount} вручную
              </span>
            )}
          </div>
        </div>
        <div className="wb-actions">
          {/* Initial loading — no prior result yet */}
          {analyzeLoading && !analyzeResult && (
            <button type="button" className="wb-btn wb-btn-sec" disabled>
              <span className="spinner" style={{ display: 'inline-flex' }}><Sparkles size={13} /></span>
              Анализирую...
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
              Повторить ревью
            </button>
          )}
          {/* Improve / retry */}
          {analyzeResult && (
            improveLoading ? (
              <button type="button" className="wb-btn wb-btn-sec" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><Wand2 size={13} /></span>
                Улучшаю...
              </button>
            ) : improveStatus === 'error' ? (
              <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                <RotateCcw size={13} />
                Повторить
              </button>
            ) : hasImprove ? (
              <button type="button" className="wb-btn wb-btn-sec" onClick={runImprove}
                disabled={improveLoading || analyzeLoading}>
                <Wand2 size={13} />
                Улучшить ещё
              </button>
            ) : (
              <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                <Wand2 size={13} />
                Улучшить
              </button>
            )
          )}
          {/* Draft */}
          {improvedTabAccessible && improveStatus !== 'error' && (
            hasDraft ? (
              <button type="button" className="wb-btn wb-btn-done" disabled>
                <CheckCircle2 size={13} />
                Черновик создан
              </button>
            ) : draftLoading ? (
              <button type="button" className="wb-btn wb-btn-sec" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><CheckCircle2 size={13} /></span>
                Создаю...
              </button>
            ) : canDraft ? (
              <button
                type="button"
                className={`wb-btn ${improveStatus === 'partial' ? 'wb-btn-sec-warn' : 'wb-btn-sec'}`}
                title={improveStatus === 'partial' ? 'Кейс улучшен частично — рекомендуется доработка' : undefined}
                onClick={() => setShowSectionPicker(true)}
              >
                <CheckCircle2 size={13} />
                Создать черновик
              </button>
            ) : null
          )}
          {/* Apply to original */}
          {improvedTabAccessible && improveStatus !== 'error' && (
            hasApply ? (
              <button type="button" className="wb-btn wb-btn-done" disabled>
                <CheckCircle2 size={13} />
                Применено
              </button>
            ) : applyLoading ? (
              <button type="button" className="wb-btn-apply" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><Wand2 size={13} /></span>
                Применяю...
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
                  Применить к оригиналу
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
            runCreateDraft()
          }}
          onCancel={() => setShowSectionPicker(false)}
        />
      )}

      {/* Confirm apply modal */}
      {showConfirmApply && (
        <ConfirmApplyModal
          workItemId={fetchResult.work_item_id}
          onConfirm={runApplyToOriginal}
          onCancel={() => setShowConfirmApply(false)}
        />
      )}

      {/* Apply error */}
      {applyError && (
        <div className="alert alert-error" style={{ margin: '0 0 8px' }}>
          <span className="alert-text">Ошибка применения: {applyError}</span>
        </div>
      )}

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
          </div>
          <div className="wb-content">
            {activeTab === 'original' && <TestCaseView tc={tc} />}
            {activeTab === 'improved' && improveStatus === 'error' && (
              <div className="improve-error-block">
                <AlertTriangle size={24} className="improve-error-icon" />
                <div className="improve-error-body">
                  <div className="improve-error-title">Не удалось выполнить улучшение</div>
                  <div className="improve-error-msg">{humanizeImproveError(improveError ?? '')}</div>
                </div>
                <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                  <RotateCcw size={13} />
                  Повторить
                </button>
              </div>
            )}
            {activeTab === 'improved' && improveStatus === 'partial' && mergedImproved && (
              <>
                <div className="improve-partial-banner">
                  <AlertTriangle size={14} />
                  <span>Улучшение выполнено частично. Часть полей требует проверки.</span>
                  {(improveResult?.validation_warnings?.length ?? 0) > 0 && (
                    <span className="improve-partial-detail">
                      {improveResult!.validation_warnings!.join('; ')}
                    </span>
                  )}
                </div>
                <TestCaseView tc={mergedImproved} partialFields={partialFields} />
              </>
            )}
            {activeTab === 'improved' && improveStatus === 'success' && mergedImproved && (
              <TestCaseView tc={mergedImproved} />
            )}
            {activeTab === 'diff' && (
              <DiffView changes={improveResult?.diff?.changes ?? []} />
            )}
            {activeTab === 'json' && (
              <pre className="wb-json-pre">
                {JSON.stringify(hasImprove ? improveResult!.improved_testcase : tc, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* Right: AI Review rail */}
        <div className="rail-panel">
          <div className="rail-head">
            <span className="rail-title">AI Ревью</span>
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
                    <div className="score-head">Оценка качества</div>
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
                              <Check size={11} strokeWidth={2.5} />{resolvedCount} решено
                            </span>
                          )}
                          {hasImprove && manualCount > 0 && (
                            <span className="score-ctr sctr-warn">
                              <AlertTriangle size={11} />{manualCount} вручную
                            </span>
                          )}
                          {!hasImprove && (
                            <span style={{ fontSize: 11, color: 'var(--tx-muted)' }}>
                              {analyzeResult.issues.length} замечаний
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
                    AI Ревью
                  </div>
                  <div className="ai-text">{analyzeResult.summary}</div>
                </div>

                {/* Issues by severity */}
                {highIssues.length > 0 && (
                  <div>
                    <div className="issues-section-label isl-high">Критичные · {highIssues.length}</div>
                    {highIssues.map((issue, i) => (
                      <IssueRow key={i} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove} />
                    ))}
                  </div>
                )}
                {medIssues.length > 0 && (
                  <div>
                    <div className="issues-section-label isl-medium">Средние · {medIssues.length}</div>
                    {medIssues.map((issue, i) => (
                      <IssueRow key={i} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove} />
                    ))}
                  </div>
                )}
                {lowIssues.length > 0 && (
                  <div>
                    <div className="issues-section-label isl-low">Низкие · {lowIssues.length}</div>
                    {lowIssues.map((issue, i) => (
                      <IssueRow key={i} issue={issue} resolution={getResolution(issue)} hasImprovement={hasImprove} />
                    ))}
                  </div>
                )}
                {analyzeResult.issues.length === 0 && (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--tx-muted)', fontSize: 13 }}>
                    Проблем не найдено
                  </div>
                )}

                {/* Manual work banner */}
                {hasImprove && (improveResult!.manual_notes?.length ?? 0) > 0 && (
                  <div className="manual-banner">
                    <div className="mb-head">
                      <Wrench size={13} />
                      Требует ручной работы
                    </div>
                    {improveResult!.manual_notes!.map((note, i) => (
                      <div key={i} className="mb-item">
                        <div className="mb-item-title">{note}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Draft card */}
                {hasDraft && (
                  <div className="draft-card">
                    <div className="draft-label">
                      <CheckCircle2 size={13} />
                      Черновик создан в TestIT
                    </div>
                    <div className="draft-name">{draftResult!.title}</div>
                    <div className="draft-meta">
                      <span className="draft-section-badge">AI Review / Черновики</span>
                      {draftResult!.testit_url && (
                        <a
                          className="draft-link"
                          href={draftResult!.testit_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Открыть в TestIT →
                        </a>
                      )}
                    </div>
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
