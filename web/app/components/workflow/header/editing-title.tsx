import { memo } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useWorkflow } from '../hooks'
import { Edit03 } from '@/app/components/base/icons/src/vender/solid/general'
import { useStore } from '@/app/components/workflow/store'

const EditingTitle = () => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useWorkflow()
  const draftUpdatedAt = useStore(state => state.draftUpdatedAt)
  const publishedAt = useStore(state => state.publishedAt)

  return (
    <div className='flex items-center h-[18px] text-xs text-gray-500'>
      <Edit03 className='mr-1 w-3 h-3 text-gray-400' />
      {t('workflow.common.editing')}
      {
        !!draftUpdatedAt && (
          <>
            <span className='flex items-center mx-1'>·</span>
            {t('workflow.common.autoSaved')} {dayjs(draftUpdatedAt).format('HH:mm:ss')}
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
