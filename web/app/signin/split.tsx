'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

type Props = {
  className?: string
}

const Split: FC<Props> = ({
  className,
}) => {
  return (
    <div
      className={cn('h-px w-[400px] bg-[linear-gradient(90deg,rgba(255,255,255,0.01)_0%,rgba(16,24,40,0.08)_50.5%,rgba(255,255,255,0.01)_100%)]', className)}>
    </div>
  )
}
export default React.memo(Split)
