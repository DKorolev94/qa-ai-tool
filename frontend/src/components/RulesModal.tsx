import { useEffect, useRef, useState } from 'react'
import { Check, Info, Minus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReviewConfig, ReviewRuleId } from '../types'

interface RulesModalProps {
  reviewConfig: ReviewConfig
  selectedPreset: string
  enabledRules: ReviewRuleId[]
  onApply: (presetId: string, rules: ReviewRuleId[]) => void
  onClose: () => void
}


export function RulesModal({ reviewConfig, selectedPreset, enabledRules, onApply, onClose }: RulesModalProps) {
  const { t } = useTranslation()
  const initialRules = useRef<ReviewRuleId[]>(enabledRules)
  const initialPreset = useRef<string>(selectedPreset)
  const [localRules, setLocalRules] = useState<ReviewRuleId[]>(enabledRules)
  const [localPreset, setLocalPreset] = useState<string>(selectedPreset)
  const [tooltip, setTooltip] = useState<{
    ruleId: string | null
    text: string | null
    style: React.CSSProperties
  }>({ ruleId: null, text: null, style: {} })

  const hasChanges =
    localPreset !== initialPreset.current ||
    JSON.stringify([...localRules].sort()) !== JSON.stringify([...initialRules.current].sort())

  const allRuleIds = reviewConfig.rules.map(r => r.id as ReviewRuleId)
  const checkedCount = allRuleIds.filter(id => localRules.includes(id)).length
  const allChecked = checkedCount === allRuleIds.length
  const someChecked = checkedCount > 0 && checkedCount < allRuleIds.length

  function selectPreset(profileId: string) {
    setLocalPreset(profileId)
    const profile = reviewConfig.profiles.find(p => p.id === profileId)
    if (profile && profile.rules.length > 0) setLocalRules(profile.rules)
  }

  function toggleAll() {
    setLocalPreset('custom')
    setLocalRules(allChecked || someChecked ? [] : allRuleIds)
  }

  function toggleRule(ruleId: ReviewRuleId) {
    setLocalPreset('custom')
    setLocalRules(prev =>
      prev.includes(ruleId) ? prev.filter(r => r !== ruleId) : [...prev, ruleId]
    )
  }

  function handleInfoEnter(ruleId: string, e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const wouldOverflowRight = rect.left + 260 > window.innerWidth - 20
    const x = wouldOverflowRight ? Math.max(rect.right - 260, 10) : rect.left
    const showAbove = rect.top > window.innerHeight * 0.65
    const style: React.CSSProperties = showAbove
      ? { bottom: window.innerHeight - rect.top + 6, left: x }
      : { top: rect.bottom + 6, left: x }
    const text = reviewConfig.rules.find(r => r.id === ruleId)?.description ?? t('rulesModal.descriptionNotAvailable')
    setTooltip({ ruleId, text, style })
  }

  function handleInfoLeave() {
    setTooltip({ ruleId: null, text: null, style: {} })
  }

  function handleReset() {
    setLocalRules(initialRules.current)
    setLocalPreset(initialPreset.current)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="rules-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rules-modal">
        {/* Header */}
        <div className="rules-modal-header">
          <span className="rules-modal-title">{t('rulesModal.title')}</span>
          <button type="button" className="rules-modal-close" onClick={onClose}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        {/* Preset selector */}
        <div className="rules-preset-bar">
          {reviewConfig.profiles.map(profile => (
            <button
              key={profile.id}
              type="button"
              className={`rules-preset-item${localPreset === profile.id ? ' active' : ''}`}
              onClick={() => selectPreset(profile.id)}
            >
              <span className="rules-preset-radio" />
              <span className="rules-preset-name">{profile.label}</span>
              {profile.rules.length > 0 && (
                <span className="rules-preset-count">{profile.rules.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Select all row */}
        <div className="rules-select-all-row">
          <button type="button" className="rules-select-all-btn" onClick={toggleAll}>
            <span className={`rules-cb${allChecked ? ' checked' : someChecked ? ' indeterminate' : ''}`}>
              {allChecked && <Check size={11} strokeWidth={2.5} />}
              {someChecked && <Minus size={11} strokeWidth={2.5} />}
            </span>
            <span className="rules-select-all-text">{t('rulesModal.selectAll')}</span>
          </button>
          <span className="rules-select-all-counter">{t('rulesModal.countOfTotal', { count: checkedCount, total: allRuleIds.length })}</span>
        </div>

        {/* Rules grid — two columns */}
        <div className="rules-scroll">
          <div className="rules-grid">
            {reviewConfig.rules.map(rule => {
              const checked = localRules.includes(rule.id as ReviewRuleId)
              return (
                <div key={rule.id} className="rules-row">
                  <button
                    type="button"
                    className={`rules-cb${checked ? ' checked' : ''}`}
                    onClick={() => toggleRule(rule.id as ReviewRuleId)}
                  >
                    {checked && <Check size={11} strokeWidth={2.5} />}
                  </button>
                  <span className="rules-name-wrap">
                    <span className={`rules-name${!checked ? ' rules-name-dim' : ''}`}>{rule.label}</span>
                    <button
                      type="button"
                      className="rules-info-btn"
                      onMouseEnter={e => handleInfoEnter(rule.id, e)}
                      onMouseLeave={handleInfoLeave}
                    >
                      <Info size={13} strokeWidth={1.75} />
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="rules-modal-footer">
          <span className="rules-footer-count">{t('rulesModal.rulesSelected', { count: localRules.length })}</span>
          <div className="rules-footer-actions">
            <button
              type="button"
              className="rules-btn-reset"
              disabled={!hasChanges}
              onClick={handleReset}
            >
              {t('rulesModal.reset')}
            </button>
            <button type="button" className="rules-btn-apply" onClick={() => onApply(localPreset, localRules)}>
              {t('rulesModal.apply')}
            </button>
          </div>
        </div>
      </div>

      {/* Tooltip — fixed position, outside scroll container to avoid overflow clipping */}
      {tooltip.ruleId && (
        <div className="rules-tooltip" style={tooltip.style}>
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
