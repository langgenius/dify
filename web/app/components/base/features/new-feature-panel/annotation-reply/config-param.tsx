'use client'
import type { FC } from 'react'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import * as React from 'react'

export const Item: FC<{ title: string; tooltip: string; children: React.JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  const titleId = React.useId()

  return (
    <div>
      <div className="mb-1 flex items-center space-x-1">
        <div id={titleId} className="py-1 system-sm-semibold text-text-secondary">
          {title}
        </div>
        <Infotip>
          <InfotipTrigger aria-labelledby={titleId} />
          <InfotipContent aria-labelledby={titleId} className="max-w-50">
            {tooltip}
          </InfotipContent>
        </Infotip>
      </div>
      <div>{children}</div>
    </div>
  )
}
