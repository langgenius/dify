'use client'
import type { FC } from 'react'
import { RiRefreshLine } from '@remixicon/react'
import * as React from 'react'
import TooltipPlus from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'

type Props = {
  className?: string
  popupContent?: string
  onClick: () => void
}

const SyncButton: FC<Props> = ({
  className,
  popupContent = '',
  onClick,
}) => {
  return (
    <TooltipPlus popupContent={popupContent}>
      <div className={cn(className, 'cursor-pointer select-none rounded-md p-1 hover:bg-state-base-hover')} onClick={onClick}>
        <RiRefreshLine className="h-4 w-4 text-text-tertiary" />
      </div>
    </TooltipPlus>
  )
}
export default React.memo(SyncButton)
