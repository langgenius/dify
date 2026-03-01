'use client'
import type { FC } from 'react'
import type { PopupProps } from './config-popup'

import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
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
  const [open, doSetOpen] = useState(false)
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    doSetOpen(v)
    openRef.current = v
  }, [doSetOpen])

  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  if (popupProps.readOnly && !hasConfigured)
    return null

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={12}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <div className={cn('select-none', className)}>
          {children}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[11]">
        <ConfigPopup {...popupProps} />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(ConfigBtn)
