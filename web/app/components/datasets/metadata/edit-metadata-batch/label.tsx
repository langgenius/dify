'use client'
import type { FC } from 'react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type Props = {
  isDeleted?: boolean
  className?: string
  text: string
}

const Label: FC<Props> = ({
  isDeleted,
  className,
  text,
}) => {
  return (
    <div className={cn(
      'system-xs-medium w-[136px] shrink-0 truncate text-text-tertiary',
      isDeleted && 'text-text-quaternary line-through',
      className,
    )}
    >
      {text}
    </div>
  )
}
export default React.memo(Label)
