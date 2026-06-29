import { ChevronLeft } from 'lucide-react'

interface SectionHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  onBack?: () => void
}

export function SectionHeader({ title, subtitle, actions, onBack }: SectionHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-left">
        {onBack && (
          <button type="button" className="back-btn" onClick={onBack}>
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
        )}
        <div className="page-header-titles">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="page-header-right">
        {actions}
      </div>
    </div>
  )
}
