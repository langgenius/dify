'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

type Props = {
  isDeleted?: boolean,
  className?: string,
  text: string
}

const Label: FC<Props> = ({
  isDeleted,
  className,
  text,
}) => {
  return (
    <div className={cn(
      'shrink-0 w-[136px] system-xs-medium text-text-tertiary truncate',
      isDeleted && 'line-through text-text-quaternary',
      className,
    )}>
      {text}
    </div>
  )
}
export default React.memo(Label)
