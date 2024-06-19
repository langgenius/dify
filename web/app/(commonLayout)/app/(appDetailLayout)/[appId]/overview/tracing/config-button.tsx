'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { PopupProps } from './config-popup'
import ConfigPopup from './config-popup'
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
} & PopupProps

const ConfigBtn: FC<Props> = ({
  className,
  hasConfigured,
  ...popupProps
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleTrigger = useCallback(() => {
    setOpen(v => !v)
  }, [setOpen])

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
