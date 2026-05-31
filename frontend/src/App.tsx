import { useEffect, useState } from 'react'
import { api, humanizeFetchError } from './api'
import { Sidebar } from './components/Sidebar'
import { ModeButton } from './components/ModeButton'
import { SourcePanel } from './components/SourcePanel'
import type { FetchResult, ReviewConfig, ReviewRuleId } from './types'

const DEFAULT_RULES: ReviewRuleId[] = [
  'structure', 'expected_results', 'test_data', 'tags',
  'duration', 'atomicity', 'independence', 'requirement_traceability',
]

const FALLBACK_CONFIG: ReviewConfig = {
  sources: [{ id: 'testit', label: 'TestIT', enabled: true }],
  profiles: [
    { id: 'standard', label: 'Базовое ревью', description: 'Только критичные проверки', rules: ['structure', 'expected_results', 'test_data', 'tags'] },
    { id: 'strict', label: 'Строгое ревью', description: 'Все проверки включены', rules: DEFAULT_RULES },
    { id: 'custom', label: 'Кастомный', description: 'Выберите правила вручную', rules: [] },
  ],
  rules: [
    { id: 'structure', label: 'Структура', group: 'Качество', enabled: true, order: 10 },
    { id: 'expected_results', label: 'Ожидаемые результаты', group: 'Качество', enabled: true, order: 20 },
    { id: 'test_data', label: 'Тестовые данные', group: 'Качество', enabled: true, order: 30 },
    { id: 'tags', label: 'Теги', group: 'Метаданные', enabled: true, order: 40 },
    { id: 'duration', label: 'Длительность', group: 'Метаданные', enabled: true, order: 50 },
    { id: 'atomicity', label: 'Атомарность', group: 'Качество', enabled: true, order: 60 },
    { id: 'independence', label: 'Независимость', group: 'Качество', enabled: true, order: 70 },
    { id: 'requirement_traceability', label: 'Связь с требованиями', group: 'Traceability', enabled: true, order: 80 },
  ],
  defaults: { testit: DEFAULT_RULES },
}

export default function App() {
  const [reviewConfig, setReviewConfig] = useState<ReviewConfig>(FALLBACK_CONFIG)
  const [selectedPreset, setSelectedPreset] = useState('strict')
  const [enabledRules, setEnabledRules] = useState<ReviewRuleId[]>(DEFAULT_RULES)

  const [testItId, setTestItId] = useState('')
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    api.getReviewConfig()
      .then(config => {
        setReviewConfig(config)
        setEnabledRules(config.defaults['testit'] ?? DEFAULT_RULES)
      })
      .catch(() => {})
  }, [])

  async function handleFetch() {
    const id = testItId.trim()
    if (!id) return
    setFetchLoading(true)
    setFetchError(null)
    setFetchResult(null)
    try {
      const data = await api.fetchWorkItem(id)
      setFetchResult(data)
    } catch (err) {
      setFetchError(humanizeFetchError((err as Error).message))
    } finally {
      setFetchLoading(false)
    }
  }

  function handleTestItIdChange(v: string) {
    setTestItId(v)
    if (fetchResult || fetchError) {
      setFetchResult(null)
      setFetchError(null)
    }
  }

  const presetLabel = reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? 'Строгое ревью'

  if (fetchResult) {
    return (
      <div className="app">
        <Sidebar onToggle={() => {}} />
        <main className="workspace">
          <div className="workspace-inner" style={{ justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center', color: 'var(--tx-muted)', fontSize: 14 }}>
              <div style={{ fontWeight: 500, color: 'var(--tx-primary)', marginBottom: 6 }}>
                {fetchResult.normalized_testcase.title}
              </div>
              <div>Воркбенч будет добавлен в следующей итерации</div>
              <button
                type="button"
                style={{ marginTop: 16, padding: '8px 16px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--bg-panel)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--tx-secondary)' }}
                onClick={() => { setFetchResult(null); setFetchError(null) }}
              >
                ← Назад
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar onToggle={() => {}} />
      <main className="workspace">
        <div className="workspace-inner">
          <div className="workspace-col">
            <div className="page-header">
              <ModeButton
                reviewConfig={reviewConfig}
                selectedPreset={selectedPreset}
                enabledRules={enabledRules}
                onApply={(preset, rules) => { setSelectedPreset(preset); setEnabledRules(rules) }}
              />
            </div>
            <SourcePanel
              testItId={testItId}
              onTestItIdChange={handleTestItIdChange}
              fetchLoading={fetchLoading}
              fetchResult={fetchResult}
              fetchError={fetchError}
              onFetch={handleFetch}
              presetLabel={presetLabel}
              enabledRulesCount={enabledRules.length}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
