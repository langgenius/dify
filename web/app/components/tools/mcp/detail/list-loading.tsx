'use client'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

const ListLoading = () => {
  return (
    <div className={cn('space-y-2')}>
      <div className="space-y-3 rounded-xl bg-components-panel-on-panel-item-bg-hover p-4">
        <div className="h-2 w-[180px] rounded-xs bg-text-quaternary opacity-20"></div>
        <div className="h-2 rounded-xs bg-text-quaternary opacity-10"></div>
        <div className="mr-10 h-2 rounded-xs bg-text-quaternary opacity-10"></div>
      </div>
      <div className="space-y-3 rounded-xl bg-components-panel-on-panel-item-bg-hover p-4">
        <div className="h-2 w-[148px] rounded-xs bg-text-quaternary opacity-20"></div>
        <div className="h-2 rounded-xs bg-text-quaternary opacity-10"></div>
        <div className="mr-10 h-2 rounded-xs bg-text-quaternary opacity-10"></div>
      </div>
      <div className="space-y-3 rounded-xl bg-components-panel-on-panel-item-bg-hover p-4">
        <div className="h-2 w-[196px] rounded-xs bg-text-quaternary opacity-20"></div>
        <div className="h-2 rounded-xs bg-text-quaternary opacity-10"></div>
        <div className="mr-10 h-2 rounded-xs bg-text-quaternary opacity-10"></div>
      </div>
      <div className="space-y-3 rounded-xl bg-components-panel-on-panel-item-bg-hover p-4">
        <div className="h-2 w-[148px] rounded-xs bg-text-quaternary opacity-20"></div>
        <div className="h-2 rounded-xs bg-text-quaternary opacity-10"></div>
        <div className="mr-10 h-2 rounded-xs bg-text-quaternary opacity-10"></div>
      </div>
      <div className="space-y-3 rounded-xl bg-components-panel-on-panel-item-bg-hover p-4">
        <div className="h-2 w-[180px] rounded-xs bg-text-quaternary opacity-20"></div>
        <div className="h-2 rounded-xs bg-text-quaternary opacity-10"></div>
        <div className="mr-10 h-2 rounded-xs bg-text-quaternary opacity-10"></div>
      </div>
    </div>
  )
}

export default ListLoading
