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
    <div className='bg-background-section system-xs-regular text-text-tertiary flex min-h-[42px] w-full items-center justify-center rounded-[10px]'>
      {children}
    </div>
  )
}
export default React.memo(ListNoDataPlaceholder)
