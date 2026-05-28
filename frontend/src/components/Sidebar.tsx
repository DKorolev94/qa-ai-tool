interface NavItem {
  icon: React.ReactNode
  label: string
  active?: boolean
  soon?: boolean
}

function IconTestCase() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <rect x="2.5" y="2.5" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 9.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconSparkle() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <path d="M9 2L10.5 7H15.5L11.5 10L13 15L9 12L5 15L6.5 10L2.5 7H7.5L9 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconCollapse({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 16 16" fill="none"
      style={{ transition: 'transform 0.2s ease', transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  { icon: <IconTestCase />, label: 'Ревью тест-кейсов', active: true },
  { icon: <IconSparkle />, label: 'Генерация тест-кейсов', soon: true },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside className="layout-sidebar flex flex-col select-none overflow-hidden">
      {/* Logo */}
      <div className="sidebar-logo-row">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="sidebar-logo-icon flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 9.5L6 2.5L10 9.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.5 7h5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="text-sm font-semibold sidebar-brand block truncate">QA AI Tools</span>
              <span className="text-[10px] sidebar-version">beta</span>
            </div>
          )}
        </div>
      </div>

      {/* Nav section */}
      {!collapsed && (
        <div className="px-3 pt-4 pb-1.5">
          <span className="sidebar-section-label">Инструменты</span>
        </div>
      )}

      <nav className="flex-1 px-2 pb-2 overflow-y-auto" style={{ paddingTop: collapsed ? '12px' : '0' }}>
        {NAV_ITEMS.map((item) => (
          <NavRow key={item.label} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="sidebar-divider mx-3 my-1" />

      <div className="px-2 py-2 flex-shrink-0 flex flex-col gap-0.5">
        <NavRow item={{ icon: <IconSettings />, label: 'Настройки' }} collapsed={collapsed} />
        <button
          type="button"
          className="sidebar-nav-row"
          onClick={onToggle}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
        >
          <span className="flex-shrink-0 flex items-center justify-center w-[15px]">
            <IconCollapse collapsed={collapsed} />
          </span>
          {!collapsed && <span className="text-xs sidebar-label">Свернуть</span>}
        </button>
      </div>
    </aside>
  )
}

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const baseClass = 'sidebar-nav-row'

  if (item.active) {
    return (
      <button
        type="button"
        className={`${baseClass} sidebar-nav-row-active`}
        title={item.label}
        aria-current="page"
      >
        <span className="sidebar-nav-active-line" />
        <span className="flex-shrink-0 flex items-center justify-center w-[15px]">{item.icon}</span>
        {!collapsed && (
          <span className="text-xs font-medium sidebar-label leading-tight">{item.label}</span>
        )}
      </button>
    )
  }

  if (item.soon) {
    return (
      <div
        className={`${baseClass} sidebar-nav-row-soon`}
        title={`${item.label} — скоро`}
      >
        <span className="flex-shrink-0 flex items-center justify-center w-[15px]">{item.icon}</span>
        {!collapsed && (
          <>
            <span className="text-xs flex-1 sidebar-label leading-tight min-w-0">{item.label}</span>
            <span className="sidebar-soon flex-shrink-0">скоро</span>
          </>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={baseClass}
      title={item.label}
    >
      <span className="flex-shrink-0 flex items-center justify-center w-[15px]">{item.icon}</span>
      {!collapsed && <span className="text-xs sidebar-label leading-tight">{item.label}</span>}
    </button>
  )
}
