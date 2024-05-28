'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'

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
      className={cn(className, 'p-1 cursor-pointer rounded-md hover:bg-black/5 text-gray-500 hover:text-gray-800')}
      onClick={onClick}
    >
      <Trash03 className='w-4 h-4' />
    </div>
  )
}
export default React.memo(Remove)
