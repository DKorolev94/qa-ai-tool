import { FileCheck2, Sparkles, Zap, Settings, PanelLeftClose } from 'lucide-react'

interface SidebarProps {
  onToggle: () => void
}

export function Sidebar({ onToggle }: SidebarProps) {
  return (
    <aside className="sidebar">
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
        <div className="sb-item sb-item-active">
          <div className="sb-icon"><FileCheck2 size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Ревью и улучшение</span>
            <span className="sb-sub">тест-кейсов</span>
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
        <div className="sb-item">
          <div className="sb-icon"><Settings size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy"><span className="sb-title">Настройки</span></div>
        </div>
        <button type="button" className="sb-item" onClick={onToggle}>
          <div className="sb-icon"><PanelLeftClose size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy"><span className="sb-title">Свернуть</span></div>
        </button>
      </div>
    </aside>
  )
}
