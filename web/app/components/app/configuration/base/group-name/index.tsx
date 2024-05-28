'use client'
import type { FC } from 'react'
import React from 'react'

export type IGroupNameProps = {
  name: string
}

const GroupName: FC<IGroupNameProps> = ({
  name,
}) => {
  return (
    <div className='flex items-center mb-1'>
      <div className='mr-3 leading-[18px] text-xs font-semibold text-gray-500 uppercase'>{name}</div>
      <div className='grow h-[1px]'
        style={{
          background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, #F3F4F6 100%)',

        }}
      ></div>
    </div>
  )
}
export default React.memo(GroupName)
