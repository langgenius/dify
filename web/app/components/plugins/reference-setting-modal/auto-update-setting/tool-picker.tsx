'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type Props = {
    trigger: React.ReactNode
  value: string[]
  onChange: (value: string[]) => void
  isShow: boolean
  onShowChange: (isShow: boolean) => void

}

const ToolPicker: FC<Props> = ({
  trigger,
  value,
  onChange,
  isShow,
  onShowChange,
}) => {
  const toggleShowPopup = useCallback(() => {
    onShowChange(!isShow)
  }, [onShowChange, isShow])
  return (
    <PortalToFollowElem
        placement='top-start'
        offset={0}
        open={isShow}
        onOpenChange={onShowChange}
      >
        <PortalToFollowElemTrigger
          onClick={toggleShowPopup}
        >
          {trigger}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div>aafdf</div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
  )
}
export default React.memo(ToolPicker)
