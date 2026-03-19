'use client'
import type { FC } from 'react'
import * as React from 'react'
import Tooltip from '@/app/components/base/tooltip'

export const Item: FC<{ title: string, tooltip: string, children: React.JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  return (
    <div>
      <div className="mb-1 flex items-center space-x-1">
        <div className="py-1 text-text-secondary system-sm-semibold">{title}</div>
        <Tooltip
          popupContent={
            <div className="max-w-[200px] text-text-secondary system-sm-regular">{tooltip}</div>
          }
        />
      </div>
      <div>{children}</div>
    </div>
  )
}
