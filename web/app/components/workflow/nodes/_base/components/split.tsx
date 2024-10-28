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
    <div className={cn(className, 'h-[0.5px] bg-divider-subtle')}>
    </div>
  )
}
export default React.memo(Split)
