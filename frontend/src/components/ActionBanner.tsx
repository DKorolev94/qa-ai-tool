import { CheckCircle2, FilePlus, ExternalLink } from 'lucide-react'
import type { ActionNotification } from '../types'

interface Props {
  notifications: ActionNotification[]
}

export function ActionBanner({ notifications }: Props) {
  if (notifications.length === 0) return null
  return (
    <div className="action-banner">
      {notifications.map((n) => (
        <div key={`${n.type}-${n.id}`} className={`action-banner-row${n.isPartial ? ' action-banner-row--partial' : ''}`}>
          <span className="action-banner-icon">
            {n.type === 'apply'
              ? <CheckCircle2 size={14} strokeWidth={2} />
              : <FilePlus size={14} strokeWidth={2} />}
          </span>
          <span className="action-banner-text">
            {n.type === 'apply'
              ? <>Применено к оригиналу · <strong>#{n.id}</strong></>
              : <>Создан черновик в секции «{n.sectionName}» · <strong>#{n.id}</strong></>}
            {n.isPartial && <span className="action-banner-partial"> · кейс ещё требует доработки</span>}
          </span>
          {n.testit_url && (
            <a
              className="action-banner-link"
              href={n.testit_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Открыть в TestIT
              <ExternalLink size={11} strokeWidth={2} style={{ marginLeft: 3 }} />
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
