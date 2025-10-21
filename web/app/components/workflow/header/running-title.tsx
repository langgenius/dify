import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsChatMode } from '../hooks'
import { useStore } from '../store'
import { formatWorkflowRunIdentifier } from '../utils'
import { ClockPlay } from '@/app/components/base/icons/src/vender/line/time'

const RunningTitle = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const historyWorkflowData = useStore(s => s.historyWorkflowData)

  return (
    <div className='flex h-[18px] items-center text-xs text-gray-500'>
      <ClockPlay className='mr-1 h-3 w-3 text-gray-500' />
      <span>{isChatMode ? `Test Chat${formatWorkflowRunIdentifier(historyWorkflowData?.finished_at)}` : `Test Run${formatWorkflowRunIdentifier(historyWorkflowData?.finished_at)}`}</span>
      <span className='mx-1'>·</span>
      <span className='ml-1 flex h-[18px] items-center rounded-[5px] border border-indigo-300 bg-white/[0.48] px-1 text-[10px] font-semibold uppercase text-indigo-600'>
        {t('workflow.common.viewOnly')}
      </span>
    </div>
  )
}

export default memo(RunningTitle)
