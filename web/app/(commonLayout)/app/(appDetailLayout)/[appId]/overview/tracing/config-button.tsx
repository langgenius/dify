'use client'
import type { FC } from 'react'
import type { PopupProps } from './config-popup'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import ConfigPopup from './config-popup'

type Props = Readonly<{
  readOnly: boolean
  className?: string
  hasConfigured: boolean
  disabled?: boolean
  children?: React.ReactNode
}> &
  PopupProps

const ConfigBtn: FC<Props> = ({
  className,
  hasConfigured,
  disabled = false,
  children,
  ...popupProps
}) => {
  if (popupProps.readOnly && !hasConfigured) return null

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            className={cn(
              'h-auto gap-0 rounded-xl border-components-panel-border bg-background-default-dodge p-2 hover:bg-background-default-lighter',
              className,
            )}
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-end"
        sideOffset={12}
        className="border-none bg-transparent shadow-none"
      >
        <ConfigPopup {...popupProps} />
      </PopoverContent>
    </Popover>
  )
}
export default React.memo(ConfigBtn)
