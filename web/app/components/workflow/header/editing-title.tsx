import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useStore } from '@/app/components/workflow/store'
import useTimestamp from '@/hooks/use-timestamp'

const EditingTitle = () => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const draftUpdatedAt = useStore(state => state.draftUpdatedAt)
  const publishedAt = useStore(state => state.publishedAt)
  const isSyncingWorkflowDraft = useStore(s => s.isSyncingWorkflowDraft)

  return (
    <div className='system-xs-regular flex h-[18px] items-center text-text-tertiary'>
      {
        !!draftUpdatedAt && (
          <>
            {t('workflow.common.autoSaved')} {formatTime(draftUpdatedAt / 1000, 'HH:mm:ss')}
          </>
        )
      }
      <span className='mx-1 flex items-center'>·</span>
      {
        publishedAt
          ? `${t('workflow.common.published')} ${formatTimeFromNow(publishedAt)}`
          : t('workflow.common.unpublished')
      }
      {
        isSyncingWorkflowDraft && (
          <>
            <span className='mx-1 flex items-center'>·</span>
            {t('workflow.common.syncingData')}
          </>
        )
      }
    </div>
  )
}

export default memo(EditingTitle)
