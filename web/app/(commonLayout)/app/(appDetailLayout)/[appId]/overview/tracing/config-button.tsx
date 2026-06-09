'use client'
import type { FC } from 'react'
import type { PopupProps } from './config-popup'

import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useState } from 'react'
import ConfigPopup from './config-popup'

type Props = {
  readOnly: boolean
  className?: string
  hasConfigured: boolean
  children?: React.ReactNode
} & PopupProps

const ConfigBtn: FC<Props> = ({
  className,
  hasConfigured,
  children,
  ...popupProps
}) => {
  const [open, setOpen] = useState(false)

  if (popupProps.readOnly && !hasConfigured)
    return null

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        render={(
          <div className={cn('select-none', className)}>
            {children}
          </div>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={12}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <ConfigPopup {...popupProps} />
      </PopoverContent>
    </Popover>
  )
}
export default React.memo(ConfigBtn)
