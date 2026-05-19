'use client'
import type { FC } from 'react'
import * as React from 'react'
import { Infotip } from '@/app/components/base/infotip'

export const Item: FC<{ title: string, tooltip: string, children: React.JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  return (
    <div>
      <div className="mb-1 flex items-center space-x-1">
        <div className="py-1 system-sm-semibold text-text-secondary">{title}</div>
        <Infotip aria-label={tooltip} popupClassName="max-w-[200px] system-sm-regular text-text-secondary">
          {tooltip}
        </Infotip>
      </div>
      <div>{children}</div>
    </div>
  )
}
