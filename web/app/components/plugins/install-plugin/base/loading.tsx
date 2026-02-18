'use client'
import * as React from 'react'
import Checkbox from '@/app/components/base/checkbox'
import Placeholder from '../../card/base/placeholder'

const Loading = () => {
  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        className="shrink-0"
        checked={false}
        disabled
      />
      <div className="hover-bg-components-panel-on-panel-item-bg relative grow rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 pb-3 shadow-xs">
        <Placeholder
          wrapClassName="w-full"
        />
      </div>
    </div>
  )
}

export default React.memo(Loading)
