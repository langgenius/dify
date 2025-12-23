'use client'
import type { FC } from 'react'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type Props = {
  className?: string
  onClick: () => void
}

const AddButton: FC<Props> = ({
  className,
  onClick,
}) => {
  return (
    <div className={cn(className, 'cursor-pointer select-none rounded-md p-1 hover:bg-state-base-hover')} onClick={onClick}>
      <RiAddLine className="h-4 w-4 text-text-tertiary" />
    </div>
  )
}
export default React.memo(AddButton)
