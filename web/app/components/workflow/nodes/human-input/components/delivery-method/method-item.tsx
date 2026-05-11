import type { FC } from 'react'
import type { DeliveryMethod, EmailConfig, FormInputItem } from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiDeleteBinLine,
  RiEqualizer2Line,
  RiMailSendFill,
  RiRobot2Fill,
  RiSendPlane2Line,
} from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge/index'
import Indicator from '@/app/components/header/indicator'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
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
  const email = useAppContextWithSelector(s => s.userProfile.email)
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
      return t(`${i18nPrefix}.deliveryMethod.emailSender.testSendTipInDebugMode`, { ns: 'workflow', email })
    }
    return t(`${i18nPrefix}.deliveryMethod.emailSender.testSendTip`, { ns: 'workflow' })
  }, [method.type, method.config?.debug_mode, t, email])
  const configureLabel = t('common.configure', { ns: 'workflow' })
  const removeLabel = t('operation.remove', { ns: 'common' })

  const jumpToEmailConfigModal = useCallback(() => {
    setShowTestEmailModal(false)
    setShowEmailModal(true)
  }, [])

  return (
    <>
      <div
        className={cn(
          'group flex h-8 items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pr-2 pl-1.5 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
          isHovering && 'border-state-destructive-border bg-state-destructive-hover hover:bg-state-destructive-hover',
        )}
      >
        <div className="flex items-center gap-1.5">
          {method.type === DeliveryMethodType.WebApp && (
            <div className="rounded-sm border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5">
              <RiRobot2Fill className="h-3.5 w-3.5 text-text-primary-on-surface" />
            </div>
          )}
          {method.type === DeliveryMethodType.Email && (
            <div className="rounded-sm border border-divider-regular bg-components-icon-bg-blue-solid p-0.5">
              <RiMailSendFill className="h-3.5 w-3.5 text-text-primary-on-surface" />
            </div>
          )}
          <div className="system-xs-medium text-text-secondary capitalize">{method.type}</div>
          {method.type === DeliveryMethodType.Email
            && (method.config as EmailConfig)?.debug_mode
            && <Badge size="s" className="px-1! py-0.5!">DEBUG</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {!readonly && (
            <div className="hidden items-end gap-1 group-hover:flex">
              {method.type === DeliveryMethodType.Email && method.config && (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <ActionButton
                          aria-label={emailSenderTooltipContent}
                          onClick={() => setShowTestEmailModal(true)}
                        >
                          <RiSendPlane2Line className="h-4 w-4" />
                        </ActionButton>
                      )}
                    />
                    <TooltipContent>{emailSenderTooltipContent}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <ActionButton
                          aria-label={configureLabel}
                          onClick={() => setShowEmailModal(true)}
                        >
                          <RiEqualizer2Line className="h-4 w-4" />
                        </ActionButton>
                      )}
                    />
                    <TooltipContent>{configureLabel}</TooltipContent>
                  </Tooltip>
                </>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <ActionButton
                      aria-label={removeLabel}
                      state={isHovering ? ActionButtonState.Destructive : ActionButtonState.Default}
                      onMouseEnter={() => setIsHovering(true)}
                      onMouseLeave={() => setIsHovering(false)}
                      onClick={() => onDelete(method.type)}
                    >
                      <RiDeleteBinLine className="h-4 w-4" />
                    </ActionButton>
                  )}
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
              {t(`${i18nPrefix}.deliveryMethod.notConfigured`, { ns: 'workflow' })}
              <Indicator color="orange" className="ml-1" />
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
