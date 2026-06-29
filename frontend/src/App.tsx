import { useEffect, useState } from 'react'
import { api, humanizeFetchError } from './api'
import { Sidebar } from './components/Sidebar'
import { RunnerView } from './components/RunnerView'
import { ModeButton } from './components/ModeButton'
import { SectionHeader } from './components/SectionHeader'
import { SourcePanel } from './components/SourcePanel'
import { Workbench } from './components/Workbench'
import { ProgressBar } from './components/ProgressBar'
import type { FetchResult, ReviewConfig, ReviewRuleId } from './types'

const DEFAULT_RULES: ReviewRuleId[] = [
  'title', 'description', 'preconditions', 'steps', 'postconditions',
  'priority', 'expected_results', 'test_data', 'tags',
  'atomicity', 'independence', 'reproducibility',
]

const FALLBACK_CONFIG: ReviewConfig = {
  sources: [{ id: 'testit', label: 'TestIT', enabled: true }],
  profiles: [
    { id: 'standard', label: 'Standard review', description: 'Basic checks', rules: ['title', 'description', 'preconditions', 'steps', 'expected_results', 'test_data', 'reproducibility'] },
    { id: 'strict', label: 'Strict review', description: 'All checks enabled', rules: DEFAULT_RULES },
  ],
  rules: [
    { id: 'title', label: 'Title', description: 'Title is readable, not in snake_case/kebab-case, reflects the scenario.', group: 'Case quality', enabled: true, order: 10 },
    { id: 'description', label: 'Description', description: 'Description is present, does not duplicate the title or contradict the steps.', group: 'Case quality', enabled: true, order: 12 },
    { id: 'preconditions', label: 'Preconditions', description: 'Preconditions describe system state, not actions. No references to other test cases.', group: 'Case quality', enabled: true, order: 15 },
    { id: 'steps', label: 'Steps', description: 'Each step contains one action. The order of steps is logically possible.', group: 'Case quality', enabled: true, order: 17 },
    { id: 'postconditions', label: 'Postconditions', description: 'The final system state after the test is described.', group: 'Case quality', enabled: true, order: 18 },
    { id: 'priority', label: 'Priority', description: 'Priority matches the criticality of the scenario.', group: 'Metadata', enabled: true, order: 19 },
    { id: 'expected_results', label: 'Expected results', description: 'Each significant step has a specific expected result.', group: 'Case quality', enabled: true, order: 20 },
    { id: 'test_data', label: 'Test data', description: 'Data is explicitly specified in a separate field, not embedded in the action text.', group: 'Case quality', enabled: true, order: 30 },
    { id: 'tags', label: 'Tags', description: 'Tags match the case content: type, level, module.', group: 'Metadata', enabled: true, order: 40 },
    { id: 'atomicity', label: 'Atomicity', description: 'One case contains one verification goal.', group: 'Case quality', enabled: true, order: 60 },
    { id: 'independence', label: 'Independence', description: 'Case runs in any order without dependency on other tests.', group: 'Case quality', enabled: true, order: 70 },
    { id: 'reproducibility', label: 'Reproducibility', description: 'Case can be run without verbal explanations from the author.', group: 'Case quality', enabled: true, order: 90 },
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
    ? 'Custom'
    : (reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? 'Strict review')

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
          <RunnerView />
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
            <SectionHeader
              title="Review & Improve test cases"
              actions={
                <ModeButton
                  reviewConfig={reviewConfig}
                  selectedPreset={selectedPreset}
                  enabledRules={enabledRules}
                  onApply={(preset, rules) => { setSelectedPreset(preset); setEnabledRules(rules) }}
                />
              }
            />
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
