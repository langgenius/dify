'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { RiAddLine } from '@remixicon/react'

type Props = {
  className?: string
  onClick: () => void
}

const AddButton: FC<Props> = ({
  className,
  onClick,
}) => {
  return (
    <div className={cn(className, 'p-1 rounded-md cursor-pointer hover:bg-gray-200 select-none')} onClick={onClick}>
      <RiAddLine className='w-4 h-4 text-gray-500' />
    </div>
  )
}
export default React.memo(AddButton)
