'use client'
import type { FC } from 'react'
import React from 'react'
import { Group } from '../../../base/icons/src/vender/other'
import cn from '@/utils/classnames'
import { LoadingPlaceholder } from '@/app/components/plugins/card/base/placeholder'

const LoadingError: FC = () => {
  return (
    <div>
      <div className="flex">
        <div
          className='flex w-10 h-10 p-1 justify-center items-center gap-2 rounded-[10px]
              border-[0.5px] border-components-panel-border bg-background-default backdrop-blur-sm'>
          <div className='flex w-5 h-5 justify-center items-center'>
            <Group className='text-text-tertiary' />
          </div>
        </div>
        <div className="ml-3 grow">
          <div className="flex items-center h-5 system-md-semibold text-text-destructive">
            Plugin load error
          </div>
          <div className={cn('flex items-center h-4 space-x-0.5')}>
            This plugin will not be installed
          </div>
        </div>
      </div>
      <LoadingPlaceholder className="mt-3 w-[420px]" />
    </div>
  )
}
export default React.memo(LoadingError)
