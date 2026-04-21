'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

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
      'w-[136px] shrink-0 truncate system-xs-medium text-text-tertiary',
      isDeleted && 'text-text-quaternary line-through',
      className,
    )}
    >
      {text}
    </div>
  )
}
export default React.memo(Label)
