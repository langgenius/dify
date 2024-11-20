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
      <div className='grow relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs'>
        <Placeholder
          wrapClassName='w-full'
        />
      </div>
    </div>
  )
}

export default React.memo(Loading)
