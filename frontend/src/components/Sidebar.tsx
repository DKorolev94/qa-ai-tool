import { ChevronLeft, ChevronRight, FileCheck2, MonitorPlay, Sparkles, Zap, Settings } from 'lucide-react'

type Tool = 'review' | 'runner'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  activeTool: Tool
  onToolChange: (tool: Tool) => void
}


export function Sidebar({ collapsed, onToggle, activeTool, onToolChange }: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? ' sb-collapsed' : ''}`}>
      <div className="sb-logo">
        <div className="sb-mark"><span>QA</span></div>
        <div className="sb-brand">
          <span className="sb-brand-name">QA AI Tools</span>
          <span className="sb-brand-sub">AI Review Workspace</span>
        </div>
      </div>
      <div className="sb-section">
        <span className="sb-section-label">Инструменты</span>
      </div>
      <nav className="sb-nav">
        <div
          className={`sb-item${activeTool === 'review' ? ' sb-item-active' : ''}`}
          onClick={() => onToolChange('review')}
          style={{ cursor: 'pointer' }}
        >
          <div className="sb-icon"><FileCheck2 size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Ревью и улучшение</span>
            <span className="sb-sub">тест-кейсов</span>
          </div>
        </div>
        <div
          className={`sb-item${activeTool === 'runner' ? ' sb-item-active' : ''}`}
          onClick={() => onToolChange('runner')}
          style={{ cursor: 'pointer' }}
        >
          <div className="sb-icon"><MonitorPlay size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Test Runner</span>
            <span className="sb-sub">прогон тест-кейсов в браузере</span>
          </div>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Sparkles size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Генерация</span>
            <span className="sb-sub">тест-кейсов</span>
          </div>
          <span className="sb-badge">Скоро</span>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Zap size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Генерация</span>
            <span className="sb-sub">api-тестов</span>
          </div>
          <span className="sb-badge">Скоро</span>
        </div>
      </nav>
      <div className="sb-divider" />
      <div className="sb-bottom">
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Settings size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy"><span className="sb-title">Настройки</span></div>
          <span className="sb-badge">Скоро</span>
        </div>
        <button type="button" className="sb-item" onClick={onToggle}>
          <div className="sb-icon">
            {collapsed
              ? <ChevronRight size={16} strokeWidth={1.75} />
              : <ChevronLeft size={16} strokeWidth={1.75} />
            }
          </div>
          <div className="sb-copy"><span className="sb-title">Свернуть</span></div>
        </button>
      </div>
    </aside>
  )
}
