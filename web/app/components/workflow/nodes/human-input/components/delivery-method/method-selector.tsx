'use client'
import type { FC } from 'react'
import type { DeliveryMethod } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  RiAddLine,
  RiDiscordFill,
  RiLightbulbFlashFill,
  RiMailSendFill,
  RiRobot2Fill,
} from '@remixicon/react'
import { memo, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import { Slack, Teams } from '@/app/components/base/icons/src/public/other'
import useWorkflowNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { isTriggerWorkflow } from '@/app/components/workflow/utils/workflow-entry'
import { IS_CE_EDITION } from '@/config'
import { useProviderContextSelector } from '@/context/provider-context'
import { DeliveryMethodType } from '../../types'

const i18nPrefix = 'nodes.humanInput'

type MethodSelectorProps = {
  data: DeliveryMethod[]
  onAdd: (method: DeliveryMethod) => void
  onShowUpgradeTip: () => void
}

const MethodSelector: FC<MethodSelectorProps> = ({
  data,
  onAdd,
  onShowUpgradeTip,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const humanInputEmailDeliveryEnabled = useProviderContextSelector(s => s.humanInputEmailDeliveryEnabled)
  const nodes = useWorkflowNodes()

  const webAppDeliveryInfo = useMemo(() => {
    const isTriggerMode = isTriggerWorkflow(nodes)
    return {
      disabled: isTriggerMode || data.some(method => method.type === DeliveryMethodType.WebApp),
      added: data.some(method => method.type === DeliveryMethodType.WebApp),
      isTriggerMode,
    }
  }, [data, nodes])

  const emailDeliveryInfo = useMemo(() => {
    return {
      noPermission: !humanInputEmailDeliveryEnabled,
      added: data.some(method => method.type === DeliveryMethodType.Email),
    }
  }, [data, humanInputEmailDeliveryEnabled])

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        render={(
          <ActionButton
            aria-label={t(`${i18nPrefix}.deliveryMethod.title`, { ns: 'workflow' })}
            className={cn(open && 'bg-state-base-hover')}
          >
            <RiAddLine className="h-4 w-4" />
          </ActionButton>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-1">
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', webAppDeliveryInfo.disabled && 'cursor-not-allowed bg-transparent hover:bg-transparent')}
              onClick={() => {
                if (webAppDeliveryInfo.disabled)
                  return
                onAdd({
                  id: uuid4(),
                  type: DeliveryMethodType.WebApp,
                  enabled: true,
                })
              }}
            >
              <div className={cn('rounded-sm border border-divider-regular bg-components-icon-bg-indigo-solid p-1', webAppDeliveryInfo.disabled && 'opacity-50')}>
                <RiRobot2Fill className="h-4 w-4 text-text-primary-on-surface" />
              </div>
              <div className={cn('p-1', webAppDeliveryInfo.disabled && 'opacity-50')}>
                <div className="mb-0.5 truncate system-sm-medium text-text-primary">{t(`${i18nPrefix}.deliveryMethod.types.webapp.title`, { ns: 'workflow' })}</div>
                <div className="truncate system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.types.webapp.description`, { ns: 'workflow' })}</div>
              </div>
              {webAppDeliveryInfo.added && (
                <div className="absolute top-[13px] right-[12px] system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.added`, { ns: 'workflow' })}</div>
              )}
              {webAppDeliveryInfo.isTriggerMode && !webAppDeliveryInfo.added && (
                <div className="absolute top-[13px] right-[12px] system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.notAvailableInTriggerMode`, { ns: 'workflow' })}</div>
              )}
            </div>
            <div
              className={cn(
                'relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover',
                emailDeliveryInfo.added && 'cursor-not-allowed bg-transparent hover:bg-transparent',
              )}
              onClick={() => {
                if (emailDeliveryInfo.noPermission) {
                  onShowUpgradeTip()
                  return
                }
                if (emailDeliveryInfo.added)
                  return
                onAdd({
                  id: uuid4(),
                  type: DeliveryMethodType.Email,
                  enabled: false,
                })
              }}
            >
              <div
                className={cn(
                  'rounded-sm border border-divider-regular bg-components-icon-bg-blue-solid p-1',
                  emailDeliveryInfo.added && 'opacity-50',
                )}
              >
                <RiMailSendFill className="h-4 w-4 text-text-primary-on-surface" />
              </div>
              <div className={cn('p-1', emailDeliveryInfo.added && 'opacity-50')}>
                <div className="mb-0.5 truncate system-sm-medium text-text-primary">{t(`${i18nPrefix}.deliveryMethod.types.email.title`, { ns: 'workflow' })}</div>
                <div className="truncate system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.types.email.description`, { ns: 'workflow' })}</div>
              </div>
              {emailDeliveryInfo.added && (
                <div className="absolute top-[13px] right-[12px] system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.added`, { ns: 'workflow' })}</div>
              )}
            </div>
            {/* Slack */}
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', 'cursor-not-allowed bg-transparent hover:bg-transparent')}
            >
              <div className={cn('rounded-sm border border-divider-regular bg-background-default-dodge p-1', 'opacity-50')}>
                <Slack className="h-4 w-4 text-text-primary-on-surface" />
              </div>
              <div className={cn('p-1', 'opacity-50')}>
                <div className="mb-0.5 truncate system-sm-medium text-text-primary">{t(`${i18nPrefix}.deliveryMethod.types.slack.title`, { ns: 'workflow' })}</div>
                <div className="truncate system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.types.slack.description`, { ns: 'workflow' })}</div>
              </div>
              <div className="absolute top-[8px] right-[8px]">
                <Badge className="h-4">COMING SOON</Badge>
              </div>
            </div>
            {/* Teams */}
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', 'cursor-not-allowed bg-transparent hover:bg-transparent')}
            >
              <div className={cn('rounded-sm border border-divider-regular bg-background-default-dodge p-1', 'opacity-50')}>
                <Teams className="h-4 w-4 text-text-primary-on-surface" />
              </div>
              <div className={cn('p-1', 'opacity-50')}>
                <div className="mb-0.5 truncate system-sm-medium text-text-primary">{t(`${i18nPrefix}.deliveryMethod.types.teams.title`, { ns: 'workflow' })}</div>
                <div className="truncate system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.types.teams.description`, { ns: 'workflow' })}</div>
              </div>
              <div className="absolute top-[8px] right-[8px]">
                <Badge className="h-4">COMING SOON</Badge>
              </div>
            </div>
            {/* Discord */}
            <div
              className={cn('relative flex cursor-pointer items-center gap-1 rounded-lg p-1 pl-3 hover:bg-state-base-hover', 'cursor-not-allowed bg-transparent hover:bg-transparent')}
            >
              <div className={cn('rounded-sm border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5', 'opacity-50')}>
                <RiDiscordFill className="h-5 w-5 text-text-primary-on-surface" />
              </div>
              <div className={cn('p-1', 'opacity-50')}>
                <div className="mb-0.5 truncate system-sm-medium text-text-primary">{t(`${i18nPrefix}.deliveryMethod.types.discord.title`, { ns: 'workflow' })}</div>
                <div className="truncate system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.types.discord.description`, { ns: 'workflow' })}</div>
              </div>
              <div className="absolute top-[8px] right-[8px]">
                <Badge className="h-4">COMING SOON</Badge>
              </div>
            </div>
          </div>
        </div>
        {!IS_CE_EDITION && (
          <div className="mt-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
            <div className="flex items-center gap-2 px-4 py-3">
              <div className={cn('rounded-sm border border-divider-regular bg-components-icon-bg-midnight-solid p-1')}>
                <RiLightbulbFlashFill className="h-4 w-4 text-text-primary-on-surface" />
              </div>
              <div className="system-sm-regular text-text-secondary">
                <div>{t(`${i18nPrefix}.deliveryMethod.contactTip1`, { ns: 'workflow' })}</div>
                <Trans
                  i18nKey={`${i18nPrefix}.deliveryMethod.contactTip2`}
                  ns="workflow"
                  components={{ email: <a href="mailto:support@dify.ai" className="text-text-accent-light-mode-only">support@dify.ai</a> }}
                />
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
export default memo(MethodSelector)
