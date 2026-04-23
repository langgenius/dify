'use client'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { memo } from 'react'
import ParamConfigContent from '@/app/components/base/features/new-feature-panel/text-to-speech/param-config-content'

type VoiceSettingsProps = {
  open: boolean
  onOpen: (state: boolean) => void
  onChange?: OnFeaturesChange
  disabled?: boolean
  children?: React.ReactNode
  placementLeft?: boolean
}
const VoiceSettings = ({
  open,
  onOpen,
  onChange,
  disabled,
  children,
  placementLeft = true,
}: VoiceSettingsProps) => {
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled)
          return
        onOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        nativeButton={false}
        render={(
          <div className="flex">
            {children}
          </div>
        )}
      />
      <PopoverContent
        placement={placementLeft ? 'left' : 'top'}
        sideOffset={placementLeft ? 32 : 4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-[360px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-2xl">
          <ParamConfigContent onClose={() => onOpen(false)} onChange={onChange} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
export default memo(VoiceSettings)
