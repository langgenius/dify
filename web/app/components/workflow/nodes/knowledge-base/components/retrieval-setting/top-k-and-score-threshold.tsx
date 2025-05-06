import { memo } from 'react'
import Tooltip from '@/app/components/base/tooltip'
import Input from '@/app/components/base/input'
import Switch from '@/app/components/base/switch'

const TopKAndScoreThreshold = () => {
  return (
    <div className='grid grid-cols-2 gap-4'>
      <div>
        <div className='system-xs-medium mb-0.5 flex h-6 items-center text-text-secondary'>
          Top k
          <Tooltip
            triggerClassName='ml-0.5 shrink-0 w-3.5 h-3.5'
            popupContent='top k'
          />
        </div>
        <Input
          type='number'
        />
      </div>
      <div>
        <div className='mb-0.5 flex h-6 items-center'>
          <Switch
            className='mr-2'
          />
          <div className='system-sm-medium grow truncate text-text-secondary'>
            Score Threshold
          </div>
          <Tooltip
            triggerClassName='shrink-0 ml-0.5 w-3.5 h-3.5'
            popupContent='Score Threshold'
          />
        </div>
        <Input
          type='number'
        />
      </div>
    </div>
  )
}

export default memo(TopKAndScoreThreshold)
