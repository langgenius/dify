'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiMailSendFill,
  RiRobot2Fill,
} from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  onEdit: () => void
}

const MethodSelector: FC<Props> = ({
  onEdit,
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

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 12,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <div>
          <ActionButton className={cn(open && 'bg-state-base-hover')}>
            <RiAddLine className='h-4 w-4' />
          </ActionButton>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-50'>
        <div className='w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm'>
          <div className='p-1'>
            <div className='relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover'>
              <div className='rounded-[4px] border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5'>
                <RiRobot2Fill className='h-3.5 w-3.5 text-text-primary-on-surface' />
              </div>
              <div className='p-1'>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.webapp.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.webapp.description`)}</div>
              </div>
            </div>
            <div className='relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover'>
              <div className='rounded-[4px] border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5'>
                <RiMailSendFill className='h-3.5 w-3.5 text-text-primary-on-surface' />
              </div>
              <div className='p-1'>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.email.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.email.description`)}</div>
              </div>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(MethodSelector)
