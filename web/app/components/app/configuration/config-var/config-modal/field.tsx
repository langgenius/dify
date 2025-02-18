'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

interface Props {
  className?: string
  title: string
  children: React.JSX.Element
}

const Field: FC<Props> = ({
  className,
  title,
  children,
}) => {
  return (
    <div className={cn(className)}>
      <div className='text-text-secondary system-sm-semibold leading-8'>{title}</div>
      <div>{children}</div>
    </div>
  )
}
export default React.memo(Field)
