import { useEffect, useState } from 'react'
import { CheckCircle2, FilePlus, ExternalLink, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ActionNotification } from '../types'

interface Props {
  notifications: ActionNotification[]
}

const EXIT_MS = 180

export function ActionBanner({ notifications }: Props) {
  if (notifications.length === 0) return null
  return (
    <div className="action-banner">
      {notifications.map(n => (
        <BannerRow key={`${n.type}-${n.id}`} notification={n} />
      ))}
    </div>
  )
}

// Stays until the user dismisses it — it carries the "Open in TestIT" link,
// so it must not disappear before the user has had a chance to click it.
// Keyed by `${type}-${id}` in the parent, so a fresh draft/apply result (new id)
// always mounts a new instance and starts un-dismissed.
function BannerRow({ notification: n }: { notification: ActionNotification }) {
  const { t } = useTranslation()
  const [closing, setClosing] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => setDismissed(true), EXIT_MS)
    return () => clearTimeout(timer)
  }, [closing])

  if (dismissed) return null

  return (
    <div
      className={`action-banner-row${n.isPartial ? ' action-banner-row--partial' : ''}${closing ? ' action-banner-row--closing' : ''}`}
    >
      <span className="action-banner-icon">
        {n.type === 'apply'
          ? <CheckCircle2 size={14} strokeWidth={2} />
          : <FilePlus size={14} strokeWidth={2} />}
      </span>
      <span className="action-banner-text">
        {n.type === 'apply'
          ? <>{t('actionBanner.appliedToOriginal')} · <strong>#{n.id}</strong></>
          : <>{t('actionBanner.draftCreatedIn', { sectionName: n.sectionName })} · <strong>#{n.id}</strong></>}
        {n.isPartial && <span className="action-banner-partial"> · {t('actionBanner.stillNeedsWork')}</span>}
        {n.testit_url && (
          <a
            className="action-banner-link"
            href={n.testit_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {' · '}{t('actionBanner.openInTestIt')}
            <ExternalLink size={11} strokeWidth={2} style={{ marginLeft: 3, verticalAlign: 'middle' }} />
          </a>
        )}
      </span>
      <button
        type="button"
        className="action-banner-close"
        onClick={() => setClosing(true)}
        aria-label={t('actionBanner.dismiss')}
        title={t('actionBanner.dismiss')}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
