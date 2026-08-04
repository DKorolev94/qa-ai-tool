import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, humanizeFetchError } from './api'
import { Sidebar } from './components/Sidebar'
import { RunnerView } from './components/RunnerView'
import { BulkReviewView } from './components/BulkReviewView'
import { ModeButton } from './components/ModeButton'
import { SectionHeader } from './components/SectionHeader'
import { SourcePanel } from './components/SourcePanel'
import { Workbench } from './components/Workbench'
import { ProgressBar } from './components/ProgressBar'
import { DEFAULT_RULES, buildFallbackConfig } from './reviewConfigFallback'
import type { FetchResult, ReviewConfig, ReviewRuleId } from './types'

export default function App() {
  const { t, i18n } = useTranslation()
  const [reviewConfig, setReviewConfig] = useState<ReviewConfig>(() => buildFallbackConfig(i18n.language))
  const [selectedPreset, setSelectedPreset] = useState('strict')
  const [enabledRules, setEnabledRules] = useState<ReviewRuleId[]>(DEFAULT_RULES)

  const [testItId, setTestItId] = useState('')
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTool, setActiveTool] = useState<'review' | 'runner' | 'bulk'>('review')
  const hasLoadedRulesRef = useRef(false)

  useEffect(() => {
    api.getReviewConfig()
      .then(config => {
        setReviewConfig(config)
        if (!hasLoadedRulesRef.current) {
          setEnabledRules(config.defaults['testit'] ?? DEFAULT_RULES)
          hasLoadedRulesRef.current = true
        }
      })
      .catch(() => {
        setReviewConfig(buildFallbackConfig(i18n.language))
      })
  }, [i18n.language])

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
    ? t('modeButton.custom')
    : (reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? reviewConfig.profiles.find(p => p.id === 'strict')?.label ?? '')

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

  if (activeTool === 'bulk') {
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
            <BulkReviewView />
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
            <SectionHeader
              title={t('app.reviewImproveTitle')}
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
