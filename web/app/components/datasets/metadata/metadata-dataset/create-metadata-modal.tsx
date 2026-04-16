'use client'
import type { FC } from 'react'
import type { Props as CreateContentProps } from './create-content'
import * as React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../../../base/ui/popover'
import CreateContent from './create-content'

type Props = {
  open: boolean
  setOpen: (open: boolean) => void
  onSave: (data: any) => void
  trigger: React.ReactNode
  popupLeft?: number
} & CreateContentProps

const CreateMetadataModal: FC<Props> = ({
  open,
  setOpen,
  trigger,
  popupLeft = 20,
  ...createContentProps
}) => {
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
        popupClassName="border-none bg-transparent shadow-none"
      >
        <CreateContent {...createContentProps} onClose={() => setOpen(false)} onBack={() => setOpen(false)} />
      </PopoverContent>
    </Popover>

  )
}
export default React.memo(CreateMetadataModal)
