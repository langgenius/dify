'use client'
import { memo } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import SettingContent from '@/app/components/base/features/new-feature-panel/file-upload/setting-content'
import type { OnFeaturesChange } from '@/app/components/base/features/types'

type FileUploadSettingsProps = {
  open: boolean
  onOpen: (state: any) => void
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
    <PortalToFollowElem
      open={open}
      onOpenChange={onOpen}
      placement='left'
      offset={{
        mainAxis: 32,
      }}
    >
      <PortalToFollowElemTrigger className='flex' onClick={() => !disabled && onOpen((open: boolean) => !open)}>
        {children}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 50 }}>
        <div className='w-[360px] p-4 bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-2xl'>
          <SettingContent
            imageUpload={imageUpload}
            onClose={() => onOpen(false)}
            onChange={(v) => {
              onChange?.(v)
              onOpen(false)
            }} />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default memo(FileUploadSettings)
