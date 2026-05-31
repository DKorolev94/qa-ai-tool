import { useState } from 'react'
import { Info, Search, X } from 'lucide-react'
import type { ReviewConfig, ReviewRuleId } from '../types'

interface RulesModalProps {
  reviewConfig: ReviewConfig
  enabledRules: ReviewRuleId[]
  onApply: (rules: ReviewRuleId[]) => void
  onClose: () => void
}

type Severity = 'critical' | 'medium' | 'low'
type Tab = 'all' | Severity

const SEVERITY_MAP: Record<string, Severity> = {
  structure: 'critical',
  expected_results: 'critical',
  test_data: 'medium',
  atomicity: 'medium',
  independence: 'medium',
  requirement_traceability: 'medium',
  tags: 'low',
  duration: 'low',
}

// TODO: replace with real API call when backend supports rule descriptions
async function fetchRuleDescription(ruleId: string): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, 700))
  const descriptions: Record<string, string> = {
    structure: 'Тест-кейс должен иметь чёткую структуру: предусловие, шаги, ожидаемый результат.',
    expected_results: 'Каждый шаг должен содержать конкретный ожидаемый результат.',
    test_data: 'Все тестовые данные должны быть явно указаны в шагах.',
    atomicity: 'Тест-кейс должен проверять ровно одну функцию или сценарий.',
    independence: 'Тест-кейс не должен зависеть от результатов других кейсов.',
    requirement_traceability: 'Кейс должен быть связан с требованием или задачей.',
    tags: 'Теги должны быть заполнены и отражать модуль и тип теста.',
    duration: 'Должна быть указана ожидаемая длительность выполнения.',
  }
  return descriptions[ruleId] ?? 'Описание правила недоступно.'
}

function getSeverity(ruleId: string): Severity {
  return SEVERITY_MAP[ruleId] ?? 'medium'
}

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Критичные',
  medium: 'Средние',
  low: 'Низкие',
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#D92D20',
  medium: '#F59E0B',
  low: '#60A5FA',
}

const SEVERITY_ORDER: Severity[] = ['critical', 'medium', 'low']

export function RulesModal({ reviewConfig, enabledRules, onApply, onClose }: RulesModalProps) {
  const [localRules, setLocalRules] = useState<ReviewRuleId[]>(enabledRules)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [tooltip, setTooltip] = useState<{ ruleId: string | null; loading: boolean; text: string | null }>({
    ruleId: null, loading: false, text: null,
  })

  function toggleRule(ruleId: ReviewRuleId) {
    setLocalRules(prev =>
      prev.includes(ruleId) ? prev.filter(r => r !== ruleId) : [...prev, ruleId]
    )
  }

  async function handleInfoEnter(ruleId: string) {
    setTooltip({ ruleId, loading: true, text: null })
    const text = await fetchRuleDescription(ruleId)
    setTooltip({ ruleId, loading: false, text })
  }

  function handleInfoLeave() {
    setTooltip({ ruleId: null, loading: false, text: null })
  }

  const filteredRules = reviewConfig.rules.filter(rule => {
    const matchesTab = activeTab === 'all' || getSeverity(rule.id) === activeTab
    const matchesSearch = rule.label.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesTab && matchesSearch
  })

  const countBySeverity = (sev: Severity) =>
    reviewConfig.rules.filter(r => getSeverity(r.id) === sev).length

  const grouped = SEVERITY_ORDER.map(sev => ({
    severity: sev,
    rules: filteredRules.filter(r => getSeverity(r.id) === sev),
  })).filter(g => g.rules.length > 0)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'all', label: 'Все' },
    { id: 'critical', label: 'Критичные' },
    { id: 'medium', label: 'Средние' },
    { id: 'low', label: 'Низкие' },
  ]

  return (
    <div className="rules-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rules-modal">
        {/* Header */}
        <div className="rules-modal-header">
          <span className="rules-modal-title">Правила ревью</span>
          <div className="rules-search-wrap">
            <span className="rules-search-icon"><Search size={13} strokeWidth={1.75} /></span>
            <input
              className="rules-search"
              type="text"
              placeholder="Поиск правил…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          <button type="button" className="rules-modal-close" onClick={onClose}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        {/* Tabs */}
        <div className="rules-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`rules-tab${activeTab === tab.id ? ' rules-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id !== 'all' && (
                <span className="rules-tab-count">{countBySeverity(tab.id as Severity)}</span>
              )}
            </button>
          ))}
        </div>

        {/* Rules list */}
        <div className="rules-scroll">
          {grouped.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--tx-dim)', fontSize: 13 }}>
              Правила не найдены
            </div>
          )}
          {grouped.map(({ severity, rules }) => (
            <div key={severity}>
              <div className="rules-group-label">
                <span className="severity-dot" style={{ background: SEVERITY_COLORS[severity] }} />
                {SEVERITY_LABELS[severity]}
              </div>
              {rules.map(rule => (
                <div key={rule.id} className="rules-row">
                  <button
                    type="button"
                    className={`rules-toggle${localRules.includes(rule.id as ReviewRuleId) ? ' on' : ''}`}
                    onClick={() => toggleRule(rule.id as ReviewRuleId)}
                  >
                    <span className="rules-toggle-knob" />
                  </button>
                  <span className="rules-name">{rule.label}</span>
                  <span
                    className={`severity-dot severity-dot-${severity}`}
                  />
                  <button
                    type="button"
                    className="rules-info-btn"
                    onMouseEnter={() => handleInfoEnter(rule.id)}
                    onMouseLeave={handleInfoLeave}
                  >
                    <Info size={14} strokeWidth={1.75} />
                  </button>
                  {tooltip.ruleId === rule.id && (
                    <div className="rules-tooltip">
                      {tooltip.loading
                        ? <span className="rules-tooltip-loading">Загрузка описания…</span>
                        : tooltip.text
                      }
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="rules-modal-footer">
          <span className="rules-footer-count">Выбрано {localRules.length} правил</span>
          <div className="rules-footer-actions">
            <button type="button" className="rules-btn-reset" onClick={() => setLocalRules(enabledRules)}>
              Сбросить
            </button>
            <button type="button" className="rules-btn-apply" onClick={() => onApply(localRules)}>
              Применить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
