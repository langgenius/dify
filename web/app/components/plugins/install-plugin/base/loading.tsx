'use client'
import React from 'react'
import Placeholder from '../../card/base/placeholder'
import Checkbox from '@/app/components/base/checkbox'

const Loading = () => {
  return (
    <div className='flex items-center space-x-2'>
      <Checkbox
        className='shrink-0'
        checked={false}
        disabled
      />
      <div className='border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg shadow-xs relative grow rounded-xl border-[0.5px] p-4 pb-3'>
        <Placeholder
          wrapClassName='w-full'
        />
      </div>
    </div>
  )
}

export default React.memo(Loading)
