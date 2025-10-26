'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiDiscordFill,
  RiLightbulbFlashFill,
  RiMailSendFill,
  RiRobot2Fill,
} from '@remixicon/react'
import { Slack, Teams } from '@/app/components/base/icons/src/public/other'
import ActionButton from '@/app/components/base/action-button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Badge from '@/app/components/base/badge'
import type { DeliveryMethod } from '../../types'
import { DeliveryMethodType } from '../../types'
import { IS_CE_EDITION } from '@/config'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  data: DeliveryMethod[]
  onAdd: (method: DeliveryMethod) => void
}

const MethodSelector: FC<Props> = ({
  data,
  onAdd,
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
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', data.some(method => method.type === DeliveryMethodType.WebApp) && 'cursor-not-allowed bg-transparent hover:bg-transparent')}
              onClick={() => {
                if (data.some(method => method.type === DeliveryMethodType.WebApp))
                  return
                onAdd({
                  type: DeliveryMethodType.WebApp,
                  enabled: true,
                })
              }}
            >
              <div className={cn('rounded-[4px] border border-divider-regular bg-components-icon-bg-indigo-solid p-1', data.some(method => method.type === DeliveryMethodType.WebApp) && 'opacity-50')}>
                <RiRobot2Fill className='h-4 w-4 text-text-primary-on-surface' />
              </div>
              <div className={cn('p-1', data.some(method => method.type === DeliveryMethodType.WebApp) && 'opacity-50')}>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.webapp.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.webapp.description`)}</div>
              </div>
              {data.some(method => method.type === DeliveryMethodType.WebApp) && (
                <div className='system-xs-regular absolute right-[12px] top-[13px] text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.added`)}</div>
              )}
            </div>
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', data.some(method => method.type === DeliveryMethodType.Email) && 'cursor-not-allowed bg-transparent hover:bg-transparent')}
              onClick={() => {
                if (data.some(method => method.type === DeliveryMethodType.Email))
                  return
                onAdd({
                  type: DeliveryMethodType.Email,
                  enabled: false,
                })
              }}
            >
              <div className={cn('rounded-[4px] border border-divider-regular bg-components-icon-bg-blue-solid p-1', data.some(method => method.type === DeliveryMethodType.Email) && 'opacity-50')}>
                <RiMailSendFill className='h-4 w-4 text-text-primary-on-surface' />
              </div>
              <div className={cn('p-1', data.some(method => method.type === DeliveryMethodType.Email) && 'opacity-50')}>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.email.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.email.description`)}</div>
              </div>
              {data.some(method => method.type === DeliveryMethodType.Email) && (
                <div className='system-xs-regular absolute right-[12px] top-[13px] text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.added`)}</div>
              )}
            </div>
            {/* Slack */}
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', 'cursor-not-allowed bg-transparent hover:bg-transparent')}
            >
              <div className={cn('rounded-[4px] border border-divider-regular bg-background-default-dodge p-1', 'opacity-50')}>
                <Slack className='h-4 w-4 text-text-primary-on-surface' />
              </div>
              <div className={cn('p-1', 'opacity-50')}>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.slack.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.slack.description`)}</div>
              </div>
              <div className='absolute right-[8px] top-[8px]'>
                <Badge className='h-4'>COMING SOON</Badge>
              </div>
            </div>
            {/* Teams */}
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', 'cursor-not-allowed bg-transparent hover:bg-transparent')}
            >
              <div className={cn('rounded-[4px] border border-divider-regular bg-background-default-dodge p-1', 'opacity-50')}>
                <Teams className='h-4 w-4 text-text-primary-on-surface' />
              </div>
              <div className={cn('p-1', 'opacity-50')}>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.teams.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.teams.description`)}</div>
              </div>
              <div className='absolute right-[8px] top-[8px]'>
                <Badge className='h-4'>COMING SOON</Badge>
              </div>
            </div>
            {/* Discord */}
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', 'cursor-not-allowed bg-transparent hover:bg-transparent')}
            >
              <div className={cn('rounded-[4px] border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5', 'opacity-50')}>
                <RiDiscordFill className='h-5 w-5 text-text-primary-on-surface' />
              </div>
              <div className={cn('p-1', 'opacity-50')}>
                <div className='system-sm-medium mb-0.5 truncate text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.types.discord.title`)}</div>
                <div className='system-xs-regular truncate text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.types.discord.description`)}</div>
              </div>
              <div className='absolute right-[8px] top-[8px]'>
                <Badge className='h-4'>COMING SOON</Badge>
              </div>
            </div>
          </div>
        </div>
        {!IS_CE_EDITION && (
          <div className='mt-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm'>
            <div className='flex items-center gap-2 px-4 py-3'>
              <div className={cn('rounded-[4px] border border-divider-regular bg-components-icon-bg-midnight-solid p-1')}>
                <RiLightbulbFlashFill className='h-4 w-4 text-text-primary-on-surface' />
              </div>
              <div className='system-sm-regular text-text-secondary'>
                <div>{t(`${i18nPrefix}.deliveryMethod.contactTip1`)}</div>
                <Trans
                  i18nKey={t(`${i18nPrefix}.deliveryMethod.contactTip2`)}
                  components={{ email: <a href="mailto:support@dify.ai" className='text-text-accent-light-mode-only'>support@dify.ai</a> }}
                />
              </div>
            </div>
          </div>
        )}
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(MethodSelector)
