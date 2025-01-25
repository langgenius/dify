'use client'
import { memo } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ParamConfigContent from '@/app/components/base/features/new-feature-panel/text-to-speech/param-config-content'
import type { OnFeaturesChange } from '@/app/components/base/features/types'

type VoiceSettingsProps = {
  open: boolean
  onOpen: (state: any) => void
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
    <PortalToFollowElem
      open={open}
      onOpenChange={onOpen}
      placement={placementLeft ? 'left' : 'top'}
      offset={{
        mainAxis: placementLeft ? 32 : 4,
      }}
    >
      <PortalToFollowElemTrigger className='flex' onClick={() => !disabled && onOpen((open: boolean) => !open)}>
        {children}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 50 }}>
        <div className='w-[360px] p-4 bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-2xl'>
          <ParamConfigContent onClose={() => onOpen(false)} onChange={onChange} />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default memo(VoiceSettings)
