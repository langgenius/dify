import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflow } from '../hooks'
import { useStore } from '../store'
import { ClockRefresh } from '@/app/components/base/icons/src/vender/line/time'

const RestoringTitle = () => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useWorkflow()
  const publishedAt = useStore(state => state.publishedAt)

  return (
    <div className='flex h-[18px] items-center text-xs text-gray-500'>
      <ClockRefresh className='mr-1 h-3 w-3 text-gray-500' />
      {t('workflow.common.latestPublished')}<span> </span>
      {formatTimeFromNow(publishedAt)}
    </div>
  )
}

export default memo(RestoringTitle)
