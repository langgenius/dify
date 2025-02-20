'use client'
import type { FC } from 'react'
import React from 'react'
import { RiAddLine } from '@remixicon/react'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  onClick: () => void
}

const AddButton: FC<Props> = ({
  className,
  onClick,
}) => {
  return (
    <div className={cn(className, 'p-1 rounded-md cursor-pointer hover:bg-state-base-hover select-none')} onClick={onClick}>
      <RiAddLine className='w-4 h-4 text-text-tertiary' />
    </div>
  )
}
export default React.memo(AddButton)
