import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflow } from '../hooks'
import { useStore } from '@/app/components/workflow/store'
import useTimestamp from '@/hooks/use-timestamp'

const EditingTitle = () => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const { formatTimeFromNow } = useWorkflow()
  const draftUpdatedAt = useStore(state => state.draftUpdatedAt)
  const publishedAt = useStore(state => state.publishedAt)
  const isSyncingWorkflowDraft = useStore(s => s.isSyncingWorkflowDraft)

  return (
    <div className='flex items-center h-[18px] system-xs-regular text-text-tertiary'>
      {
        !!draftUpdatedAt && (
          <>
            {t('workflow.common.autoSaved')} {formatTime(draftUpdatedAt / 1000, 'HH:mm:ss')}
          </>
        )
      }
      <span className='flex items-center mx-1'>·</span>
      {
        publishedAt
          ? `${t('workflow.common.published')} ${formatTimeFromNow(publishedAt)}`
          : t('workflow.common.unpublished')
      }
      {
        isSyncingWorkflowDraft && (
          <>
            <span className='flex items-center mx-1'>·</span>
            {t('workflow.common.syncingData')}
          </>
        )
      }
    </div>
  )
}

export default memo(EditingTitle)
