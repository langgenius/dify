'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PopupProps } from './config-popup'
import ConfigPopup from './config-popup'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

const I18N_PREFIX = 'app.tracing'

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
  const { t } = useTranslation()
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

  const triggerContent = hasConfigured
    ? (
      <div className={cn(className, 'p-1 rounded-md hover:bg-black/5 cursor-pointer')}>
        <Settings04 className='w-4 h-4 text-gray-500' />
      </div>
    )
    : (
      <Button variant='primary'
        className={cn(className, '!h-8 !px-3 select-none')}
      >
        <Settings04 className='mr-1 w-4 h-4' />
        <span className='text-[13px]'>{t(`${I18N_PREFIX}.config`)}</span>
      </Button>
    )

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 12,
        crossAxis: hasConfigured ? 8 : 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        {triggerContent}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <ConfigPopup {...popupProps} />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(ConfigBtn)
