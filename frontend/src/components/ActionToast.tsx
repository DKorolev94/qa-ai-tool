import { useEffect } from 'react'
import { CheckCircle2, FilePlus, ExternalLink, X } from 'lucide-react'
import type { ActionNotification } from '../types'

interface Props {
  notification: ActionNotification | null
  onClose: () => void
}

export function ActionToast({ notification, onClose }: Props) {
  useEffect(() => {
    if (!notification) return
    const id = setTimeout(onClose, 6000)
    return () => clearTimeout(id)
  }, [notification, onClose])

  if (!notification) return null

  const n = notification
  return (
    <div className={`action-toast${n.isPartial ? ' action-toast--partial' : ''}`}>
      <span className="action-toast-icon">
        {n.type === 'apply'
          ? <CheckCircle2 size={15} strokeWidth={2} />
          : <FilePlus size={15} strokeWidth={2} />}
      </span>
      <span className="action-toast-text">
        {n.type === 'apply'
          ? <>Применено к оригиналу · <strong>#{n.id}</strong></>
          : <>Черновик создан в «{n.sectionName}» · <strong>#{n.id}</strong></>}
        {n.testit_url && (
          <>
            {' · '}
            <a
              className="action-toast-link"
              href={n.testit_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Открыть в TestIT
              <ExternalLink size={10} strokeWidth={2} style={{ marginLeft: 2 }} />
            </a>
          </>
        )}
      </span>
      <button type="button" className="action-toast-close" onClick={onClose} aria-label="Закрыть">
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
