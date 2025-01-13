'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  children: React.ReactNode
}

const ListNoDataPlaceholder: FC<Props> = ({
  children,
}) => {
  return (
    <div className='flex w-full rounded-[10px] bg-background-section items-center min-h-[42px] justify-center system-xs-regular text-text-tertiary'>
      {children}
    </div>
  )
}
export default React.memo(ListNoDataPlaceholder)
