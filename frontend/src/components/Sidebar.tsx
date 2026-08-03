import { ChevronLeft, ChevronRight, FileCheck2, MonitorPlay, Sparkles, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n, { setLanguage } from '../i18n'

type Tool = 'review' | 'runner'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  activeTool: Tool
  onToolChange: (tool: Tool) => void
}


export function Sidebar({ collapsed, onToggle, activeTool, onToolChange }: SidebarProps) {
  const { t } = useTranslation()

  return (
    <aside className={`sidebar${collapsed ? ' sb-collapsed' : ''}`}>
      <div className="sb-logo">
        <div className="sb-mark"><span>QA</span></div>
        <div className="sb-brand">
          <span className="sb-brand-name">{t('sidebar.brandName')}</span>
          <span className="sb-brand-sub">{t('sidebar.brandSub')}</span>
        </div>
      </div>
      <div className="sb-section">
        <span className="sb-section-label">{t('sidebar.toolsLabel')}</span>
      </div>
      <nav className="sb-nav">
        <div
          className={`sb-item${activeTool === 'review' ? ' sb-item-active' : ''}`}
          onClick={() => onToolChange('review')}
          style={{ cursor: 'pointer' }}
        >
          <div className="sb-icon"><FileCheck2 size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">{t('sidebar.reviewImprove')}</span>
            <span className="sb-sub">{t('sidebar.reviewImproveSub')}</span>
          </div>
        </div>
        <div
          className={`sb-item${activeTool === 'runner' ? ' sb-item-active' : ''}`}
          onClick={() => onToolChange('runner')}
          style={{ cursor: 'pointer' }}
        >
          <div className="sb-icon"><MonitorPlay size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">{t('sidebar.testRunner')}</span>
            <span className="sb-sub">{t('sidebar.testRunnerSub')}</span>
          </div>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Sparkles size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">{t('sidebar.generate')}</span>
            <span className="sb-sub">{t('sidebar.generateSub')}</span>
          </div>
          <span className="sb-badge">{t('sidebar.soon')}</span>
        </div>

      </nav>
      <div className="sb-divider" />
      <div className="sb-bottom">
        <div className="sb-item sb-item-lang" style={{ cursor: 'default' }}>
          <div className="sb-copy"><span className="sb-title">{t('sidebar.language')}</span></div>
          <div className="sb-lang-switch">
            <button
              type="button"
              className={`sb-lang-btn${i18n.language === 'ru' ? ' active' : ''}`}
              onClick={() => setLanguage('ru')}
            >
              RU
            </button>
            <button
              type="button"
              className={`sb-lang-btn${i18n.language === 'en' ? ' active' : ''}`}
              onClick={() => setLanguage('en')}
            >
              EN
            </button>
          </div>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Settings size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy"><span className="sb-title">{t('sidebar.settings')}</span></div>
          <span className="sb-badge">{t('sidebar.soon')}</span>
        </div>
        <button type="button" className="sb-item" onClick={onToggle}>
          <div className="sb-icon">
            {collapsed
              ? <ChevronRight size={16} strokeWidth={1.75} />
              : <ChevronLeft size={16} strokeWidth={1.75} />
            }
          </div>
          <div className="sb-copy"><span className="sb-title">{t('sidebar.collapse')}</span></div>
        </button>
      </div>
    </aside>
  )
}
