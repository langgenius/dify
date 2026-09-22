'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import * as React from 'react'

type Props = Readonly<{
  className?: string
  icon: React.JSX.Element
  name: string
  description: string
  children: React.JSX.Element
}>

const ItemPanel: FC<Props> = ({ className, icon, name, description, children }) => {
  return (
    <div
      className={cn(
        className,
        'flex h-12 items-center justify-between rounded-lg bg-background-section-burn px-3',
      )}
    >
      <div className="flex items-center">
        {icon}
        <div className="mr-1 ml-3 text-sm/6 font-semibold text-text-secondary">{name}</div>
        <Infotip>
          <InfotipTrigger aria-label={description} />
          <InfotipContent aria-label={description} className="w-45">
            {description}
          </InfotipContent>
        </Infotip>
      </div>
      <div>{children}</div>
    </div>
  )
}
export default React.memo(ItemPanel)
