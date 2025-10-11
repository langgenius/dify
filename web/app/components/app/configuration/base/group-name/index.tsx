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
    <div className='mb-1 flex items-center'>
      <div className='mr-3 text-xs font-semibold uppercase leading-[18px] text-text-tertiary'>{name}</div>
      <div className='h-px grow'
        style={{
          background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, #F3F4F6 100%)',

        }}
      ></div>
    </div>
  )
}
export default React.memo(GroupName)
