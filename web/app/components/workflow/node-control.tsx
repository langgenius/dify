import type { FC } from 'react'
import { memo } from 'react'
import {
  DotsHorizontal,
  Loading02,
} from '@/app/components/base/icons/src/vender/line/general'
import {
  Play,
  Stop,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'

type NodeControlProps = {
  isRunning?: boolean
}
const NodeControl: FC<NodeControlProps> = ({
  isRunning,
}) => {
  return (
    <div className='absolute left-0 -top-7 flex items-center px-0.5 h-6 bg-white rounded-lg border-[0.5px] border-gray-100 shadow-xs text-gray-500'>
      {
        isRunning && (
          <div className='flex items-center px-1 h-5 rounded-md bg-primary-50 text-xs font-medium text-primary-600'>
            <Loading02 className='mr-1 w-3 h-3 animate-spin' />
            RUNNING
          </div>
        )
      }
      <div className='flex items-center justify-center w-5 h-5 cursor-pointer'>
        {
          isRunning
            ? <Stop className='w-3 h-3' />
            : <Play className='w-3 h-3' />
        }
      </div>
      <div className='flex items-center justify-center w-5 h-5 cursor-pointer'>
        <DotsHorizontal className='w-3 h-3' />
      </div>
    </div>
  )
}

export default memo(NodeControl)
