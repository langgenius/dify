import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import useTimestamp from '@/hooks/use-timestamp'

const EditingTitle = () => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const draftUpdatedAt = useStore(state => state.draftUpdatedAt)
  const publishedAt = useStore(state => state.publishedAt)
  const isSyncingWorkflowDraft = useStore(s => s.isSyncingWorkflowDraft)
  const maximizeCanvas = useStore(s => s.maximizeCanvas)

  return (
    <div className={`system-xs-regular flex h-[18px] min-w-[300px] items-center whitespace-nowrap text-text-tertiary ${maximizeCanvas ? 'ml-2' : ''}`}>
      {
        !!draftUpdatedAt && (
          <>
            {t('common.autoSaved', { ns: 'workflow' })}
            {' '}
            {formatTime(draftUpdatedAt / 1000, 'HH:mm:ss')}
          </>
        )
      }
      <span className="mx-1 flex items-center">·</span>
      {
        publishedAt
          ? `${t('common.published', { ns: 'workflow' })} ${formatTimeFromNow(publishedAt)}`
          : t('common.unpublished', { ns: 'workflow' })
      }
      {
        isSyncingWorkflowDraft && (
          <>
            <span className="mx-1 flex items-center">·</span>
            {t('common.syncingData', { ns: 'workflow' })}
          </>
        )
      }
    </div>
  )
}

export default memo(EditingTitle)
