'use client'
import type { FC } from 'react'
import React from 'react'
import {
  RiAddLine,
} from '@remixicon/react'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  text: string
  onClick: () => void
}

const AddButton: FC<Props> = ({
  className,
  text,
  onClick,
}) => {
  return (
    <div
      className={cn(className, 'flex items-center h-7 justify-center bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer text-xs font-medium text-gray-700 space-x-1')}
      onClick={onClick}
    >
      <RiAddLine className='w-3.5 h-3.5' />
      <div>{text}</div>
    </div>
  )
}
export default React.memo(AddButton)
