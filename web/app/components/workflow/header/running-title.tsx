import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { Play } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'

const RunningTitle = () => {
  const { t } = useTranslation()
  const appDetail = useAppStore(state => state.appDetail)

  return (
    <div className='flex items-center h-[18px] text-xs text-primary-600'>
      <Play className='mr-1 w-3 h-3' />
      {
        appDetail?.mode === 'advanced-chat'
          ? t('workflow.common.inPreviewMode')
          : t('workflow.common.inRunMode')
      }
      <span className='mx-1'>·</span>
      <span className='text-gray-500'>Test Run#2</span>
    </div>
  )
}

export default memo(RunningTitle)
