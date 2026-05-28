import type { OpStatus } from '../types'

interface Props {
  status: OpStatus | null
  onClear?: () => void
  canClear?: boolean
}

const statusConfig: Record<string, { dot: string; text: string; bg: string }> = {
  success: { dot: 'bg-ok', text: 'text-ok', bg: '' },
  error: { dot: 'bg-bad', text: 'text-bad', bg: '' },
  loading: { dot: 'bg-accent animate-pulse', text: 'text-tx-secondary', bg: '' },
  '': { dot: 'bg-tx-dim', text: 'text-tx-muted', bg: '' },
}

export function Toolbar({ status, onClear, canClear }: Props) {
  const cfg = statusConfig[status?.type ?? ''] ?? statusConfig['']

  return (
    <header className="layout-toolbar flex items-center px-4 gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm font-medium flex-1 min-w-0">
        <span className="text-tx-muted">QA AI Tools</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0 text-tx-dim">
          <path d="M4.5 9L7.5 6L4.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-tx-primary truncate font-semibold">
          Ревью и улучшение тест-кейса
        </span>
      </div>

      {/* Status */}
      {status?.msg && (
        <div className={`flex items-center gap-1.5 text-xs font-mono flex-shrink-0 transition-all duration-300 ${cfg.text}`}>
          <span className={`status-dot ${cfg.dot}`} />
          <span className="max-w-sm truncate" title={status.msg}>{status.msg}</span>
        </div>
      )}

      {/* Divider */}
      {status?.msg && <div className="w-px h-4 bg-line flex-shrink-0" />}

      {canClear && onClear && (
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-tx-muted hover:text-bad hover:bg-bad/5 border border-line hover:border-bad/25 rounded-md transition-all duration-150 flex-shrink-0"
          title="Очистить всё"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Очистить
        </button>
      )}
    </header>
  )
}
