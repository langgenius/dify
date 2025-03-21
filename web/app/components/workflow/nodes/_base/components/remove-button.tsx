'use client'
import type { FC } from 'react'
import React from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  onClick: (e: React.MouseEvent) => void
}

const Remove: FC<Props> = ({
  className,
  onClick,
}) => {
  return (
    <div
      className={cn(className, 'cursor-pointer rounded-md p-1 text-gray-500 hover:bg-black/5 hover:text-gray-800')}
      onClick={onClick}
    >
      <RiDeleteBinLine className='h-4 w-4' />
    </div>
  )
}
export default React.memo(Remove)
