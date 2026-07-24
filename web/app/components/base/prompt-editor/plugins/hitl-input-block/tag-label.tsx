'use client'
import type { FC } from 'react'
import { RiEditLine } from '@remixicon/react'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import { Variable02 } from '../../../icons/src/vender/solid/development'

type Props = {
  type: 'edit' | 'variable'
  children: string
  className?: string
  onClick?: () => void
}

const TagLabel: FC<Props> = ({
  type,
  children,
  className,
  onClick,
}) => {
  const Icon = type === 'edit' ? RiEditLine : Variable02
  return (
    <div
      className={cn('inline-flex h-5 cursor-pointer items-center space-x-1 rounded-md bg-components-button-secondary-bg px-1 text-text-accent', className)}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      <div className="system-xs-medium ">{children}</div>
    </div>
  )
}
export default React.memo(TagLabel)
