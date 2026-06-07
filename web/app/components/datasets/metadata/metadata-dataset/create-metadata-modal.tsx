'use client'
import type { Props as CreateContentProps } from './create-content'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { CreateContent } from './create-content'

type Props = {
  open: boolean
  setOpen: (open: boolean) => void
  trigger: React.ReactNode
  popupLeft?: number
} & CreateContentProps

export function CreateMetadataModal({
  open,
  setOpen,
  trigger,
  popupLeft = 20,
  ...createContentProps
}: Props) {
  const triggerElement = React.isValidElement(trigger)
    ? trigger
    : <button type="button">{trigger}</button>

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger render={triggerElement as React.ReactElement} />
      <PopoverContent
        placement="left-start"
        sideOffset={popupLeft}
        alignOffset={-38}
        popupClassName="w-[320px]"
      >
        <CreateContent {...createContentProps} onClose={() => setOpen(false)} onBack={() => setOpen(false)} />
      </PopoverContent>
    </Popover>

  )
}
