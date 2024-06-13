'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Button from '@/app/components/base/button'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

const I18N_PREFIX = 'app.tracing'

type Props = {
  className?: string

  hasConfigured: boolean
  onConfigured?: () => void
}

const ConfigBtn: FC<Props> = ({
  className,
  hasConfigured,
  onConfigured,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleTrigger = useCallback(() => {
    setOpen(v => !v)
  }, [setOpen])

  const triggerContent = hasConfigured
    ? (
      <div className='ml-2 p-1 rounded-md hover:bg-black/5 cursor-pointer'>
        <Settings04 className='w-4 h-4 text-gray-500' />
      </div>
    )
    : (
      <Button type='primary'
        className={cn(className, '!h-8 !px-3')}
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
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        {triggerContent}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        aaa
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(ConfigBtn)
