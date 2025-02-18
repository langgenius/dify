'use client'
import type { FC } from 'react'
import React from 'react'
import { RiAddLine } from '@remixicon/react'
import cn from '@/utils/classnames'

interface Props {
  className?: string
  onClick: () => void
}

const AddButton: FC<Props> = ({
  className,
  onClick,
}) => {
  return (
    <div className={cn(className, 'hover:bg-state-base-hover cursor-pointer select-none rounded-md p-1')} onClick={onClick}>
      <RiAddLine className='text-text-tertiary h-4 w-4' />
    </div>
  )
}
export default React.memo(AddButton)
