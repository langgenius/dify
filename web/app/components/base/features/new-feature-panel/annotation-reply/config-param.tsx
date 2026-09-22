'use client'
import type { FC } from 'react'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import * as React from 'react'

export const Item: FC<{ title: string; tooltip: string; children: React.JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  return (
    <div>
      <div className="mb-1 flex items-center space-x-1">
        <div className="py-1 system-sm-semibold text-text-secondary">{title}</div>
        <Infotip>
          <InfotipTrigger aria-label={tooltip} />
          <InfotipContent aria-label={tooltip} className="max-w-50">
            {tooltip}
          </InfotipContent>
        </Infotip>
      </div>
      <div>{children}</div>
    </div>
  )
}
