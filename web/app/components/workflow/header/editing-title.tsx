import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import useTimestamp from '@/hooks/use-timestamp'

function EditingTitle() {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const draftUpdatedAt = useStore((state) => state.draftUpdatedAt)
  const publishedAt = useStore((state) => state.publishedAt)
  const isSyncingWorkflowDraft = useStore((s) => s.isSyncingWorkflowDraft)

  return (
    <div
      role="status"
      aria-label={t(($) => $['common.workflowSaveStatus'], { ns: 'workflow' })}
      className="h-4 system-xs-regular text-text-tertiary"
    >
      {!!draftUpdatedAt && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span>{t(($) => $['common.autoSaved'], { ns: 'workflow' })}</span>
          <time dateTime={new Date(draftUpdatedAt).toISOString()}>
            {formatTime(draftUpdatedAt / 1000, 'HH:mm:ss')}
          </time>
        </span>
      )}
      <span aria-hidden="true" className="mx-1 inline-flex items-center">
        ·
      </span>
      {publishedAt ? (
        <span>
          <span>{t(($) => $['common.published'], { ns: 'workflow' })}</span>{' '}
          <time dateTime={new Date(publishedAt).toISOString()}>
            {formatTimeFromNow(publishedAt)}
          </time>
        </span>
      ) : (
        <span>{t(($) => $['common.unpublished'], { ns: 'workflow' })}</span>
      )}
      {isSyncingWorkflowDraft && (
        <>
          <span aria-hidden="true" className="mx-1 inline-flex items-center">
            ·
          </span>
          <span>{t(($) => $['common.syncingData'], { ns: 'workflow' })}</span>
        </>
      )}
    </div>
  )
}

export default memo(EditingTitle)
