'use client'
import type { FC } from 'react'
import React from 'react'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

type Props = {
  vars: NodeOutPutVar[]
}

const VarReferencePopup: FC<Props> = ({
  vars,
}) => {
  return (
    <div className='p-1 bg-white rounded-lg border border-gray-200 shadow-lg space-y-1'>
      {vars.map((item, i) => (
        <div key={i}>
          <div className='flex items-center h-[22px] px-3 text-xs font-medium text-gray-500 uppercase'>{item.title}</div>
          {item.vars.map((v, j) => (
            <div key={j} className='flex items-center h-6 pl-3 pr-[18px] rounded-md cursor-pointer hover:bg-gray-50'>
              <div className='flex items-center w-0 grow'>
                <Variable02 className='shrink-0 w-3.5 h-3.5 text-primary-500' />
                <div className='ml-1 w-0 grow text-ellipsis text-[13px] font-normal text-gray-900'>{v.variable}</div>
              </div>
              <div className='ml-1 shrink-0 text-xs font-normal text-gray-500'>{v.type}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
export default React.memo(VarReferencePopup)
