'use client'
import { RiEditLine } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'
import { Variable02 } from '../../../icons/src/vender/solid/development'
import cn from '@/utils/classnames'

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
      onClick={onClick}>
      <Icon className='size-3.5' />
      <div className='system-xs-medium '>{children}</div>
    </div>
  )
}
export default React.memo(TagLabel)
