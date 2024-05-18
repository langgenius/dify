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

  return (
    <div className='flex items-center h-[18px] text-xs text-gray-500'>
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
    </div>
  )
}

export default memo(EditingTitle)
