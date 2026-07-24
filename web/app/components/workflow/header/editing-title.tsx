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
      className="flex h-[18px] min-w-[300px] items-center system-xs-regular whitespace-nowrap text-text-tertiary"
    >
      {!!draftUpdatedAt && (
        <span className="flex items-center gap-1">
          <span>{t(($) => $['common.autoSaved'], { ns: 'workflow' })}</span>
          <time dateTime={new Date(draftUpdatedAt).toISOString()}>
            {formatTime(draftUpdatedAt / 1000, 'HH:mm:ss')}
          </time>
        </span>
      )}
      <span aria-hidden="true" className="mx-1 flex items-center">
        ·
      </span>
      {publishedAt ? (
        <span className="flex items-center gap-1">
          <span>{t(($) => $['common.published'], { ns: 'workflow' })}</span>
          <time dateTime={new Date(publishedAt).toISOString()}>
            {formatTimeFromNow(publishedAt)}
          </time>
        </span>
      ) : (
        <span>{t(($) => $['common.unpublished'], { ns: 'workflow' })}</span>
      )}
      {isSyncingWorkflowDraft && (
        <>
          <span aria-hidden="true" className="mx-1 flex items-center">
            ·
          </span>
          <span>{t(($) => $['common.syncingData'], { ns: 'workflow' })}</span>
        </>
      )}
    </div>
  )
}

export default memo(EditingTitle)
