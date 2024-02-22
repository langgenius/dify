import type { FC } from 'react'
import { memo } from 'react'
import { Play } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { ClockPlay } from '@/app/components/base/icons/src/vender/line/time'
import TooltipPlus from '@/app/components/base/tooltip-plus'

const RunAndHistory: FC = () => {
  return (
    <div className='flex items-center px-0.5 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs'>
      <div className={`
        flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium text-primary-600
        hover:bg-primary-50 cursor-pointer
      `}>
        <Play className='mr-1 w-4 h-4' />
        Run
      </div>
      <div className='mx-0.5 w-[0.5px] h-8 bg-gray-200'></div>
      <TooltipPlus
        popupContent='View run history'
      >
        <div className='flex items-center justify-center w-7 h-7 rounded-md hover:bg-black/5 cursor-pointer'>
          <ClockPlay className='w-4 h-4 text-gray-500' />
        </div>
      </TooltipPlus>
    </div>
  )
}

export default memo(RunAndHistory)
