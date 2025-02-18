'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

interface Props {
  className?: string
}

const Split: FC<Props> = ({
  className,
}) => {
  return (
    <div className={cn(className, 'bg-divider-subtle h-[0.5px]')}>
    </div>
  )
}
export default React.memo(Split)
