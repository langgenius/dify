'use client'
import type { FC } from 'react'
import React from 'react'
import type { Props as CreateContentProps } from './create-content'
import CreateContent from './create-content'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../../base/portal-to-follow-elem'

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
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='left-start'
      offset={{
        mainAxis: popupLeft,
        crossAxis: -38,
      }}
    >
      <PortalToFollowElemTrigger
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <CreateContent {...createContentProps} onClose={() => setOpen(false)} onBack={() => setOpen(false)} />
      </PortalToFollowElemContent>
    </PortalToFollowElem >

  )
}
export default React.memo(CreateMetadataModal)
