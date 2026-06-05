import { useEffect, useState } from 'react'
import { api, humanizeFetchError } from './api'
import { Sidebar } from './components/Sidebar'
import { RunnerView } from './components/RunnerView'
import { ModeButton } from './components/ModeButton'
import { SourcePanel } from './components/SourcePanel'
import { Workbench } from './components/Workbench'
import { ProgressBar } from './components/ProgressBar'
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
  ],
  rules: [
    { id: 'structure', label: 'Структура', description: 'Проверяет согласованность title, description, preconditions, steps и priority между собой. Флажит расплывчатые заголовки, противоречия между полями и неправильно оформленные предусловия.', group: 'Качество', enabled: true, order: 10 },
    { id: 'expected_results', label: 'Ожидаемые результаты', description: 'Проверяет наличие и конкретность ожидаемого результата у каждого значимого шага. Результат должен описывать наблюдаемое состояние системы: текст, экран, URL, статус, сообщение.', group: 'Качество', enabled: true, order: 20 },
    { id: 'test_data', label: 'Тестовые данные', description: 'Проверяет, что данные для выполнения шага явно указаны в поле test_data и отделены от описания действия. Флажит захардкоженные данные в action, неопределённые ссылки и отсутствующие обязательные значения.', group: 'Качество', enabled: true, order: 30 },
    { id: 'tags', label: 'Теги', description: 'Проверяет соответствие тегов содержанию теста: тип (smoke, regression), уровень (ui, api), модуль. Флажит неверные теги, которые могут привести к запуску не в том наборе.', group: 'Метаданные', enabled: true, order: 40 },
    { id: 'duration', label: 'Длительность', description: 'Проверяет реалистичность duration для ручного выполнения. Ориентиры: атомарный UI — 2–5 мин, стандартный — 5–15 мин, E2E/API — 15–30 мин.', group: 'Метаданные', enabled: true, order: 50 },
    { id: 'atomicity', label: 'Атомарность', description: 'Проверяет, что кейс покрывает одну основную цель. Флажит смешение нескольких независимых проверок в одном кейсе, при котором непонятно, что именно сломалось при падении.', group: 'Качество', enabled: true, order: 60 },
    { id: 'independence', label: 'Независимость', description: 'Проверяет, что кейс можно выполнить в любом порядке без зависимости от других тестов. Флажит ссылки на прохождение другого кейса и шаги, продолжающие чужой сценарий.', group: 'Качество', enabled: true, order: 70 },
    { id: 'requirement_traceability', label: 'Связь с требованиями', description: 'Проверяет наличие ссылки на требование, задачу, user story или баг-репорт. Флажит пустое поле links и отсутствие явного источника проверки.', group: 'Связанность', enabled: true, order: 80 },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTool, setActiveTool] = useState<'review' | 'runner'>('review')

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

  const presetLabel = selectedPreset === 'custom'
    ? 'Свои настройки'
    : (reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? 'Строгое ревью')

  if (activeTool === 'runner') {
    return (
      <>
        <ProgressBar active={false} />
        <div className="app">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(v => !v)}
            activeTool={activeTool}
            onToolChange={tool => { setActiveTool(tool); setFetchResult(null); setFetchError(null) }}
          />
          <main className="workspace">
            <RunnerView />
          </main>
        </div>
      </>
    )
  }

  if (fetchResult) {
    return (
      <>
        <ProgressBar active={false} />
        <div className="app">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(v => !v)}
            activeTool={activeTool}
            onToolChange={tool => { setActiveTool(tool); setFetchResult(null); setFetchError(null) }}
          />
          <main className="workspace workspace-wb">
            <Workbench
            fetchResult={fetchResult}
            reviewConfig={reviewConfig}
            selectedPreset={selectedPreset}
            enabledRules={enabledRules}
            onApply={(preset, rules) => { setSelectedPreset(preset); setEnabledRules(rules) }}
            onBack={() => { setFetchResult(null); setFetchError(null) }}
          />
          </main>
        </div>
      </>
    )
  }

  return (
    <>
      <ProgressBar active={fetchLoading} />
      <div className="app">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(v => !v)}
          activeTool={activeTool}
          onToolChange={tool => { setActiveTool(tool); setFetchResult(null); setFetchError(null) }}
        />
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
    </>
  )
}
