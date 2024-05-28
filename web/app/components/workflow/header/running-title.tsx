import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsChatMode } from '../hooks'
import { useStore } from '../store'
import { ClockPlay } from '@/app/components/base/icons/src/vender/line/time'

const RunningTitle = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const historyWorkflowData = useStore(s => s.historyWorkflowData)

  return (
    <div className='flex items-center h-[18px] text-xs text-gray-500'>
      <ClockPlay className='mr-1 w-3 h-3 text-gray-500' />
      <span>{isChatMode ? `Test Chat#${historyWorkflowData?.sequence_number}` : `Test Run#${historyWorkflowData?.sequence_number}`}</span>
      <span className='mx-1'>·</span>
      <span className='ml-1 uppercase flex items-center px-1 h-[18px] rounded-[5px] border border-indigo-300 bg-white/[0.48] text-[10px] font-semibold text-indigo-600'>
        {t('workflow.common.viewOnly')}
      </span>
    </div>
  )
}

export default memo(RunningTitle)
