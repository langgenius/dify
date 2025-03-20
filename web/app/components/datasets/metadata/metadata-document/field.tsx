'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  label: string
  children: React.ReactNode
}

const Field: FC<Props> = ({
  label,
  children,
}) => {
  return (
    <div className='flex items-start space-x-2'>
      <div className='shrink-0 w-[128px] truncate py-1 items-center text-text-tertiary system-xs-medium'>
        {label}
      </div>
      <div className='shrink-0 w-[244px]'>
        {children}
      </div>
    </div>
  )
}

export default React.memo(Field)
