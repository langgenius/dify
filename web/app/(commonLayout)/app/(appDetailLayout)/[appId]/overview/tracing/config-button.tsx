'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import type { PopupProps } from './config-popup'
import ConfigPopup from './config-popup'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type Props = {
  readOnly: boolean
  className?: string
  hasConfigured: boolean
  controlShowPopup?: number
} & PopupProps

const ConfigBtn: FC<Props> = ({
  className,
  hasConfigured,
  controlShowPopup,
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

  useEffect(() => {
    if (controlShowPopup)
      // setOpen(!openRef.current)
      setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlShowPopup])

  if (popupProps.readOnly && !hasConfigured)
    return null

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 12,
        crossAxis: hasConfigured ? 8 : 49,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <div className={cn(className, 'rounded-md p-1')}>
          <RiEqualizer2Line className='text-text-tertiary h-4 w-4' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <ConfigPopup {...popupProps} />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(ConfigBtn)
