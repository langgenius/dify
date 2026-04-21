'use client'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { memo } from 'react'
import SettingContent from '@/app/components/base/features/new-feature-panel/file-upload/setting-content'

type FileUploadSettingsProps = {
  open: boolean
  onOpen: (state: boolean) => void
  onChange?: OnFeaturesChange
  disabled?: boolean
  children?: React.ReactNode
  imageUpload?: boolean
}
const FileUploadSettings = ({
  open,
  onOpen,
  onChange,
  disabled,
  children,
  imageUpload,
}: FileUploadSettingsProps) => {
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
        placement="left"
        sideOffset={32}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="max-h-[calc(100vh-20px)] w-[360px] overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-2xl">
          <SettingContent
            imageUpload={imageUpload}
            onClose={() => onOpen(false)}
            onChange={(v) => {
              onChange?.(v)
              onOpen(false)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
export default memo(FileUploadSettings)
