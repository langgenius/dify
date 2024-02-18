'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  title: string
  children: JSX.Element | string
  operations?: JSX.Element
}

const Filed: FC<Props> = ({
  title,
  children,
  operations,
}) => {
  return (
    <div>
      <div className='flex justify-between items-center'>
        <div className='leading-[18px] text-xs font-medium text-gray-500 uppercase'>{title}</div>
        {operations && <div>{operations}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}
export default React.memo(Filed)
