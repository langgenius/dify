'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  className?: string
  label: string
  children: React.ReactNode
}

const Field: FC<Props> = ({
  className,
  label,
  children,
}) => {
  return (
    <div className={className}>
      <div className='py-1 system-sm-semibold text-text-secondary'>{label}</div>
      <div className='mt-1'>{children}</div>
    </div>
  )
}
export default React.memo(Field)
