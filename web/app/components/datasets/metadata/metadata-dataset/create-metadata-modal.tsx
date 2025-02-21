'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import type { Props as CreateContentProps } from './create-content'
import CreateContent from './create-content'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../../base/portal-to-follow-elem'

type Props = {
  onSave: (data: any) => void
  trigger: React.ReactNode
  popupLeft?: number
} & CreateContentProps

const CreateMetadataModal: FC<Props> = ({
  trigger,
  popupLeft = 20,
  ...createContentProps
}) => {
  const [open, setOpen] = useState(false)

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
        <CreateContent {...createContentProps} />
      </PortalToFollowElemContent>
    </PortalToFollowElem >

  )
}
export default React.memo(CreateMetadataModal)
