interface NavItem {
  icon: React.ReactNode
  label: string
  active?: boolean
  soon?: boolean
}

function IconTestCase() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <rect x="2.5" y="2.5" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 9.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconApi() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 2v2.5M9 13.5V16M2 9h2.5M13.5 9H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.4 4.4l1.8 1.8M11.8 11.8l1.8 1.8M13.6 4.4l-1.8 1.8M6.2 11.8l-1.8 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <line x1="3" y1="5" x2="15" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="5" r="1.75" fill="currentColor" />
      <circle cx="11" cy="9" r="1.75" fill="currentColor" />
      <circle cx="7" cy="13" r="1.75" fill="currentColor" />
    </svg>
  )
}

function IconCollapse({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      className={`transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
    >
      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  { icon: <IconTestCase />, label: 'Ревью тест-кейсов', active: true },
  { icon: <IconApi />, label: 'Генерация тест-кейсов', soon: true },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside className="layout-sidebar flex flex-col select-none overflow-hidden">
      <div className="sidebar-logo-row">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="sidebar-logo-icon flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 9.5L6 2.5L10 9.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.5 7h5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex flex-col leading-none sidebar-brand-wrap min-w-0">
            <span className="text-sm font-semibold sidebar-brand truncate">QA AI Tools</span>
          </div>
        </div>
      </div>

      <div className="px-3 pt-3 pb-1 sidebar-section-wrap">
        <span className="text-2xs font-mono uppercase tracking-widest sidebar-section-label">
          Инструменты
        </span>
      </div>

      <nav className="flex-1 px-2 pb-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavRow key={item.label} item={item} />
        ))}
      </nav>

      <div className="sidebar-divider mx-4" />

      <div className="px-2 py-2 flex-shrink-0 flex flex-col gap-0.5">
        <NavRow item={{ icon: <IconSettings />, label: 'Настройки' }} />
        <button
          type="button"
          className="sidebar-nav-row"
          onClick={onToggle}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        >
          <span className="flex-shrink-0"><IconCollapse collapsed={collapsed} /></span>
          <span className="text-sm sidebar-label">{collapsed ? 'Развернуть' : 'Свернуть'}</span>
        </button>
      </div>
    </aside>
  )
}

function NavRow({ item }: { item: NavItem }) {
  if (item.active) {
    return (
      <button
        type="button"
        className="sidebar-nav-row sidebar-nav-row-active"
        title={item.label}
        aria-current="page"
      >
        <span className="sidebar-nav-active-line" />
        <span className="flex-shrink-0">{item.icon}</span>
        <span className="text-sm font-medium sidebar-label">{item.label}</span>
      </button>
    )
  }

  if (item.soon) {
    return (
      <div className="sidebar-nav-row sidebar-nav-row-soon" title={item.label}>
        <span className="flex-shrink-0">{item.icon}</span>
        <span className="text-sm flex-1 sidebar-label">{item.label}</span>
        <span className="sidebar-soon text-2xs font-mono px-1.5 py-0.5 rounded">скоро</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="sidebar-nav-row"
      title={item.label}
    >
      <span className="flex-shrink-0">{item.icon}</span>
      <span className="text-sm sidebar-label">{item.label}</span>
    </button>
  )
}
