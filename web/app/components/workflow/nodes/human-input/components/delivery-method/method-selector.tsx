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
import type { DeliveryMethod } from '../../types'
import { DeliveryMethodType } from '../../types'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  data: DeliveryMethod[]
}

const MethodSelector: FC<Props> = ({
  data,
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
            <div className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', data.some(method => method.type === DeliveryMethodType.WebApp) && 'cursor-not-allowed bg-transparent hover:bg-transparent')}>
              <div className={cn('rounded-[4px] border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5', data.some(method => method.type === DeliveryMethodType.WebApp) && 'opacity-50')}>
                <RiRobot2Fill className='h-3.5 w-3.5 text-text-primary-on-surface' />
              </div>
              <div className={cn('p-1', data.some(method => method.type === DeliveryMethodType.WebApp) && 'opacity-50')}>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.webapp.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.webapp.description`)}</div>
              </div>
              {data.some(method => method.type === DeliveryMethodType.WebApp) && (
                <div className='system-xs-regular absolute right-[12px] top-[13px] text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.added`)}</div>
              )}
            </div>
            <div className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', data.some(method => method.type === DeliveryMethodType.Email) && 'cursor-not-allowed bg-transparent hover:bg-transparent')}>
              <div className={cn('rounded-[4px] border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5', data.some(method => method.type === DeliveryMethodType.Email) && 'opacity-50')}>
                <RiMailSendFill className='h-3.5 w-3.5 text-text-primary-on-surface' />
              </div>
              <div className={cn('p-1', data.some(method => method.type === DeliveryMethodType.Email) && 'opacity-50')}>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.email.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.email.description`)}</div>
              </div>
              {data.some(method => method.type === DeliveryMethodType.Email) && (
                <div className='system-xs-regular absolute right-[12px] top-[13px] text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.added`)}</div>
              )}
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(MethodSelector)
