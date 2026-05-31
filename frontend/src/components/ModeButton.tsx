import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Star } from 'lucide-react'
import type { ReviewConfig, ReviewRuleId } from '../types'

interface ModeButtonProps {
  reviewConfig: ReviewConfig
  selectedPreset: string
  enabledRules: ReviewRuleId[]
  onApply: (presetId: string, rules: ReviewRuleId[]) => void
}

export function ModeButton({ reviewConfig, selectedPreset, enabledRules, onApply }: ModeButtonProps) {
  const [open, setOpen] = useState(false)
  const [localPreset, setLocalPreset] = useState(selectedPreset)
  const [localRules, setLocalRules] = useState<ReviewRuleId[]>(enabledRules)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setLocalPreset(selectedPreset) }, [selectedPreset])
  useEffect(() => { setLocalRules(enabledRules) }, [enabledRules])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  function selectPreset(profileId: string) {
    setLocalPreset(profileId)
    const profile = reviewConfig.profiles.find(p => p.id === profileId)
    if (profile && profile.rules.length > 0) setLocalRules(profile.rules)
  }

  function toggleRule(ruleId: ReviewRuleId) {
    setLocalPreset('custom')
    setLocalRules(prev =>
      prev.includes(ruleId) ? prev.filter(r => r !== ruleId) : [...prev, ruleId]
    )
  }

  function handleApply() {
    onApply(localPreset, localRules)
    setOpen(false)
  }

  const currentLabel = reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? 'Строгое ревью'

  return (
    <div className="mode-btn-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`mode-btn${open ? ' open' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <span className="mode-btn-star">
          <Star size={16} strokeWidth={1.5} style={{ fill: '#F59E0B', stroke: '#F59E0B' }} />
        </span>
        <span>{currentLabel}</span>
        <span className="mode-btn-sep" />
        <span className="mode-btn-pill">{enabledRules.length} правил</span>
        <span className={`mode-btn-chevron${open ? ' open' : ''}`}>
          <ChevronDown size={16} strokeWidth={1.75} />
        </span>
      </button>

      {open && (
        <div className="review-dropdown">
          <div className="rd-header">Режим ревью</div>

          <div className="rd-presets">
            {reviewConfig.profiles.map(profile => (
              <div
                key={profile.id}
                className={`rd-preset${localPreset === profile.id ? ' active' : ''}`}
                onClick={() => selectPreset(profile.id)}
              >
                <div className="rd-radio"><div className="rd-radio-dot" /></div>
                <div className="rd-preset-copy">
                  <div className="rd-preset-name">{profile.label}</div>
                  {profile.description && (
                    <div className="rd-preset-desc">{profile.description}</div>
                  )}
                </div>
                {profile.rules.length > 0 && (
                  <span className="rd-preset-count">{profile.rules.length} правил</span>
                )}
              </div>
            ))}
          </div>

          <div className="rd-rules-section">
            <div className="rd-rules-label">Активные правила</div>
            {reviewConfig.rules.map(rule => (
              <div
                key={rule.id}
                className={`rd-rule${!localRules.includes(rule.id) ? ' disabled' : ''}`}
                onClick={() => toggleRule(rule.id)}
              >
                <div className={`rd-cb${localRules.includes(rule.id) ? ' checked' : ''}`}>
                  <span className="rd-cb-mark">
                    <Check size={10} strokeWidth={2.5} />
                  </span>
                </div>
                <span className="rd-rule-text">{rule.label}</span>
              </div>
            ))}
          </div>

          <div className="rd-footer">
            <button type="button" className="rd-link">Все правила →</button>
            <button type="button" className="rd-apply" onClick={handleApply}>Применить</button>
          </div>
        </div>
      )}
    </div>
  )
}
