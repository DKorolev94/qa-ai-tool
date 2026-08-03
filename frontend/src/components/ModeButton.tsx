import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Star } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { ReviewConfig, ReviewRuleId } from '../types'
import { RulesModal } from './RulesModal'

interface ModeButtonProps {
  reviewConfig: ReviewConfig
  selectedPreset: string
  enabledRules: ReviewRuleId[]
  onApply: (presetId: string, rules: ReviewRuleId[]) => void
}

export function ModeButton({ reviewConfig, selectedPreset, enabledRules, onApply }: ModeButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [localPreset, setLocalPreset] = useState(selectedPreset)
  const [localRules, setLocalRules] = useState<ReviewRuleId[]>(enabledRules)
  const [rulesModalOpen, setRulesModalOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (!open) setLocalPreset(selectedPreset) }, [selectedPreset, open])
  useEffect(() => { if (!open) setLocalRules(enabledRules) }, [enabledRules, open])

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

  function handleApply() {
    onApply(localPreset, localRules)
    setOpen(false)
  }

  function handleRulesApply(presetId: string, rules: ReviewRuleId[]) {
    setLocalRules(rules)
    setLocalPreset(presetId)
    onApply(presetId, rules)
    setRulesModalOpen(false)
  }

  const currentLabel = selectedPreset === 'custom'
    ? t('modeButton.custom')
    : (reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? t('modeButton.custom'))

  const total = reviewConfig.rules.length

  return (
    <>
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
          <span className="mode-btn-pill">{t('modeButton.rulesCount', { count: enabledRules.length })}</span>
          <span className={`mode-btn-chevron${open ? ' open' : ''}`}>
            <ChevronDown size={16} strokeWidth={1.75} />
          </span>
        </button>

        {open && (
          <div className="review-dropdown">
            <div className="rd-header">{t('modeButton.reviewMode')}</div>

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
                    <span className="rd-preset-count">{t('modeButton.rulesCount', { count: profile.rules.length })}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="rd-summary">
              <div className="rd-summary-line">
                <Trans i18nKey="modeButton.activeOfTotal" values={{ active: localRules.length, total }}>
                  Active <strong>{{ active: localRules.length } as any}</strong> of {{ total } as any} rules
                </Trans>
              </div>
            </div>

            <div className="rd-footer">
              <button
                type="button"
                className="rd-link"
                onClick={() => { setOpen(false); setRulesModalOpen(true) }}
              >
                {t('modeButton.allRules')}
              </button>
              <button type="button" className="rd-apply" onClick={handleApply}>{t('modeButton.apply')}</button>
            </div>
          </div>
        )}
      </div>

      {rulesModalOpen && (
        <RulesModal
          reviewConfig={reviewConfig}
          selectedPreset={localPreset}
          enabledRules={localRules}
          onApply={handleRulesApply}
          onClose={() => setRulesModalOpen(false)}
        />
      )}
    </>
  )
}
