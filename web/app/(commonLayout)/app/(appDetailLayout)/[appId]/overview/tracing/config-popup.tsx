'use client'
import type { FC } from 'react'
import React from 'react'
import TracingIcon from './tracing-icon'
import Indicator from '@/app/components/header/indicator'
type Props = {

}

const ConfigPopup: FC<Props> = () => {
  return (
    <div className='w-[420px] p-4 rounded-2xl bg-white border-[0.5px] border-black/5 shadow-lg'>
      <div className='flex justify-between justify-between'>
        <div className='flex'>
          <TracingIcon size='md' className='mr-2' />
          <div className='leading-[120%] text-[18px] font-semibold text-gray-900'>Tracing</div>
        </div>
        <div>
          <Indicator color='green' />
        </div>
      </div>
    </div>
  )
}
export default React.memo(ConfigPopup)
