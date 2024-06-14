'use client'
import type { FC } from 'react'
import React from 'react'
import TracingIcon from './tracing-icon'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'
export type PopupProps = {
  enabled: boolean
  onStatusChange?: (enabled: boolean) => void
}

const ConfigPopup: FC<PopupProps> = ({
  enabled,
  onStatusChange,
}) => {
  return (
    <div className='w-[420px] p-4 rounded-2xl bg-white border-[0.5px] border-black/5 shadow-lg'>
      <div className='flex justify-between items-center'>
        <div className='flex items-center'>
          <TracingIcon size='md' className='mr-2' />
          <div className='leading-[120%] text-[18px] font-semibold text-gray-900'>Tracing</div>
        </div>
        <div className='flex items-center'>
          <Indicator color={enabled ? 'green' : 'gray'} />
          <div className='ml-1.5 text-xs font-semibold text-gray-500 uppercase'>
            {enabled ? 'enabled' : 'disabled'}
          </div>
          <Switch
            className='ml-3'
            defaultValue={enabled}
            onChange={onStatusChange}
            size='l'
          />
        </div>
      </div>
    </div>
  )
}
export default React.memo(ConfigPopup)
