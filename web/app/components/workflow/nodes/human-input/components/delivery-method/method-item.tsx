import type { FC } from 'react'
import type { DeliveryMethod, EmailConfig, FormInputItem } from '../../types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge/index'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { DeliveryMethodType } from '../../types'
import EmailConfigureModal from './email-configure-modal'
import TestEmailSender from './test-email-sender'

const i18nPrefix = 'nodes.humanInput'

type DeliveryMethodItemProps = {
  nodeId: string
  method: DeliveryMethod
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  formContent?: string
  formInputs?: FormInputItem[]
  onChange: (method: DeliveryMethod) => void
  onDelete: (type: DeliveryMethodType) => void
  readonly?: boolean
}

const DeliveryMethodItem: FC<DeliveryMethodItemProps> = ({
  nodeId,
  method,
  nodesOutputVars,
  availableNodes,
  formContent,
  formInputs,
  onChange,
  onDelete,
  readonly,
}) => {
  const { t } = useTranslation()
  const { data: email } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const [isHovering, setIsHovering] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [showTestEmailModal, setShowTestEmailModal] = useState(false)

  const handleEnableStatusChange = (enabled: boolean) => {
    onChange({
      ...method,
      enabled,
    })
  }

  const handleConfigChange = (config: EmailConfig) => {
    onChange({
      ...method,
      config,
    })
  }

  const emailSenderTooltipContent = useMemo(() => {
    if (method.type !== DeliveryMethodType.Email) {
      return ''
    }
    if (method.config?.debug_mode) {
      return t(($) => $[`${i18nPrefix}.deliveryMethod.emailSender.testSendTipInDebugMode`], {
        ns: 'workflow',
        email,
      })
    }
    return t(($) => $[`${i18nPrefix}.deliveryMethod.emailSender.testSendTip`], { ns: 'workflow' })
  }, [method.type, method.config?.debug_mode, t, email])
  const configureLabel = t(($) => $['common.configure'], { ns: 'workflow' })
  const removeLabel = t(($) => $['operation.remove'], { ns: 'common' })

  const jumpToEmailConfigModal = useCallback(() => {
    setShowTestEmailModal(false)
    setShowEmailModal(true)
  }, [])

  return (
    <>
      <div
        className={cn(
          'group flex h-8 items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pr-2 pl-1.5 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
          isHovering &&
            'border-state-destructive-border bg-state-destructive-hover hover:bg-state-destructive-hover',
        )}
      >
        <div className="flex items-center gap-1.5">
          {method.type === DeliveryMethodType.WebApp && (
            <div className="rounded-sm border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5">
              <span
                aria-hidden
                className="i-ri-robot-2-fill size-3.5 text-text-primary-on-surface"
              />
            </div>
          )}
          {method.type === DeliveryMethodType.Email && (
            <div className="rounded-sm border border-divider-regular bg-components-icon-bg-blue-solid p-0.5">
              <span
                aria-hidden
                className="i-ri-mail-send-fill size-3.5 text-text-primary-on-surface"
              />
            </div>
          )}
          <div className="system-xs-medium text-text-secondary capitalize">{method.type}</div>
          {method.type === DeliveryMethodType.Email &&
            (method.config as EmailConfig)?.debug_mode && (
              <Badge size="s" className="px-1! py-0.5!">
                DEBUG
              </Badge>
            )}
        </div>
        <div className="flex items-center gap-1">
          {!readonly && (
            <div className="hidden items-end gap-1 group-hover:flex">
              {method.type === DeliveryMethodType.Email && method.config && (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <IconButton
                          aria-label={emailSenderTooltipContent}
                          onClick={() => setShowTestEmailModal(true)}
                        >
                          <span aria-hidden className="i-ri-send-plane-2-line size-4" />
                        </IconButton>
                      }
                    />
                    <TooltipContent>{emailSenderTooltipContent}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <IconButton
                          aria-label={configureLabel}
                          onClick={() => setShowEmailModal(true)}
                        >
                          <span aria-hidden className="i-ri-equalizer-2-line size-4" />
                        </IconButton>
                      }
                    />
                    <TooltipContent>{configureLabel}</TooltipContent>
                  </Tooltip>
                </>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <IconButton
                      aria-label={removeLabel}
                      tone="destructive"
                      onMouseEnter={() => setIsHovering(true)}
                      onMouseLeave={() => setIsHovering(false)}
                      onClick={() => onDelete(method.type)}
                    >
                      <span aria-hidden className="i-ri-delete-bin-line size-4" />
                    </IconButton>
                  }
                />
                <TooltipContent>{removeLabel}</TooltipContent>
              </Tooltip>
            </div>
          )}
          {(method.config || method.type === DeliveryMethodType.WebApp) && (
            <Switch
              checked={method.enabled}
              onCheckedChange={handleEnableStatusChange}
              disabled={readonly}
            />
          )}
          {method.type === DeliveryMethodType.Email && !method.config && (
            <Button
              className="-mr-1"
              size="small"
              onClick={() => setShowEmailModal(true)}
              disabled={readonly}
            >
              {t(($) => $[`${i18nPrefix}.deliveryMethod.notConfigured`], { ns: 'workflow' })}
              <StatusDot status="warning" />
            </Button>
          )}
        </div>
      </div>
      <EmailConfigureModal
        open={showEmailModal}
        config={method.config as EmailConfig}
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
        onOpenChange={setShowEmailModal}
        onConfirm={(data) => {
          handleConfigChange(data)
          setShowEmailModal(false)
        }}
      />
      <TestEmailSender
        nodeId={nodeId}
        deliveryId={method.id}
        open={showTestEmailModal}
        config={method.config as EmailConfig}
        formContent={formContent}
        formInputs={formInputs}
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
        onOpenChange={setShowTestEmailModal}
        jumpToEmailConfigModal={jumpToEmailConfigModal}
      />
    </>
  )
}

export default DeliveryMethodItem
