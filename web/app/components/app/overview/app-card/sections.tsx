'use client'

import type { ReactElement, ReactNode } from 'react'
import type { AppCardOperation } from './use-app-card'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { useTranslation } from 'react-i18next'
import AppBasic from '@/app/components/app-sidebar/basic'
import Button from '@/app/components/base/button'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Divider from '@/app/components/base/divider'
import ShareQRCode from '@/app/components/base/qrcode'
import Switch from '@/app/components/base/switch'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'
import style from '../style.module.css'

type AppCardDisabledOverlayProps = {
  triggerModeDisabled: boolean
  triggerModeMessage?: ReactNode
}

type AppCardHeaderProps = {
  appInfo: AppDetailResponse & Partial<AppSSO>
  basicDescription: string
  basicName: string
  cardType: 'api' | 'webapp'
  learnMoreUrl: string
  runningStatus: boolean
  toggleDisabled: boolean
  triggerModeDisabled: boolean
  triggerModeMessage?: ReactNode
  appUnpublished: boolean
  missingStartNode: boolean
  onChangeStatus: (value: boolean) => Promise<void>
}

type AppCardAddressSectionProps = {
  addressLabel: string
  apiUrl?: string | null
  appUrl: string
  genLoading: boolean
  isApp: boolean
  isCurrentWorkspaceManager: boolean
  isRegenerateDialogOpen: boolean
  onCloseRegenerateDialog: () => void
  onConfirmRegenerate: () => Promise<void>
  onOpenRegenerateDialog: () => void
}

type AppCardAccessSectionProps = {
  iconClassName: string
  isAppAccessSet: boolean
  label: string
  onClick: () => void
}

type AppCardOperationsProps = {
  appId: string
  isApp: boolean
  operations: AppCardOperation[]
  onOperationSelect: (key: AppCardOperation['key']) => void
}

const renderTooltipTrigger = (content: ReactNode) => (
  <TooltipTrigger render={content as ReactElement} />
)

export const AppCardDisabledOverlay = ({
  triggerModeDisabled,
  triggerModeMessage,
}: AppCardDisabledOverlayProps) => {
  if (!triggerModeDisabled)
    return null

  const overlay = <div className="absolute inset-0 z-10 cursor-not-allowed rounded-xl" aria-hidden="true" />

  if (!triggerModeMessage)
    return overlay

  return (
    <Tooltip>
      {renderTooltipTrigger(overlay)}
      <TooltipContent placement="right" popupClassName="max-w-64 rounded-xl bg-components-panel-bg px-3 py-2 text-xs text-text-secondary shadow-lg">
        {triggerModeMessage}
      </TooltipContent>
    </Tooltip>
  )
}

export const AppCardHeader = ({
  appInfo,
  basicDescription,
  basicName,
  cardType,
  learnMoreUrl,
  runningStatus,
  toggleDisabled,
  triggerModeDisabled,
  triggerModeMessage,
  appUnpublished,
  missingStartNode,
  onChangeStatus,
}: AppCardHeaderProps) => {
  const { t } = useTranslation()
  const switchTooltipContent = toggleDisabled
    ? (
        triggerModeDisabled && triggerModeMessage
          ? triggerModeMessage
          : (appUnpublished || missingStartNode)
              ? (
                  <>
                    <div className="mb-1 text-xs font-normal text-text-secondary">
                      {t('overview.appInfo.enableTooltip.description', { ns: 'appOverview' })}
                    </div>
                    <div
                      className="cursor-pointer text-xs font-normal text-text-accent hover:underline"
                      onClick={() => window.open(learnMoreUrl, '_blank')}
                    >
                      {t('overview.appInfo.enableTooltip.learnMore', { ns: 'appOverview' })}
                    </div>
                  </>
                )
              : null
      )
    : null
  const switchNode = (
    <div>
      <Switch value={runningStatus} onChange={onChangeStatus} disabled={toggleDisabled} />
    </div>
  )

  return (
    <div className="flex w-full items-center gap-3 self-stretch">
      <AppBasic
        iconType={cardType}
        icon={appInfo.icon}
        icon_background={appInfo.icon_background}
        name={basicName}
        hideType
        type={basicDescription}
      />
      <div className="flex shrink-0 items-center gap-1">
        <Indicator color={runningStatus ? 'green' : 'yellow'} />
        <div className={cn(runningStatus ? 'text-text-success' : 'text-text-warning', 'system-xs-semibold-uppercase')}>
          {runningStatus
            ? t('overview.status.running', { ns: 'appOverview' })
            : t('overview.status.disable', { ns: 'appOverview' })}
        </div>
      </div>
      {switchTooltipContent
        ? (
            <Tooltip>
              {renderTooltipTrigger(switchNode)}
              <TooltipContent
                placement="right"
                sideOffset={24}
                popupClassName="w-58 max-w-60 rounded-xl bg-components-panel-bg px-3.5 py-3 shadow-lg"
              >
                {switchTooltipContent}
              </TooltipContent>
            </Tooltip>
          )
        : switchNode}
    </div>
  )
}

export const AppCardAddressSection = ({
  addressLabel,
  apiUrl,
  appUrl,
  genLoading,
  isApp,
  isCurrentWorkspaceManager,
  isRegenerateDialogOpen,
  onCloseRegenerateDialog,
  onConfirmRegenerate,
  onOpenRegenerateDialog,
}: AppCardAddressSectionProps) => {
  const { t } = useTranslation()
  const address = isApp ? appUrl : (apiUrl ?? '')
  const refreshButton = (
    <button
      type="button"
      aria-label={t('overview.appInfo.regenerate', { ns: 'appOverview' })}
      className="h-6 w-6 cursor-pointer rounded-md hover:bg-state-base-hover"
      onClick={onOpenRegenerateDialog}
    >
      <div className={cn('h-full w-full', style.refreshIcon, genLoading && style.generateLogo)} />
    </button>
  )

  return (
    <div className="flex flex-col items-start justify-center self-stretch">
      <div className="pb-1 text-text-tertiary system-xs-medium">{addressLabel}</div>
      <div className="inline-flex h-9 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
        <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-text-secondary">
            {address}
          </div>
        </div>
        <CopyFeedback content={address} className="!size-6" />
        {isApp && <ShareQRCode content={appUrl} />}
        {isApp && <Divider type="vertical" className="!mx-0.5 !h-3.5 shrink-0" />}
        {isApp && isCurrentWorkspaceManager && (
          <AlertDialog open={isRegenerateDialogOpen} onOpenChange={open => !open && onCloseRegenerateDialog()}>
            <Tooltip>
              {renderTooltipTrigger(refreshButton)}
              <TooltipContent>{t('overview.appInfo.regenerate', { ns: 'appOverview' })}</TooltipContent>
            </Tooltip>
            <AlertDialogContent className="w-[480px]">
              <div className="flex flex-col items-start gap-2 self-stretch pb-4 pl-6 pr-6 pt-6">
                <AlertDialogTitle className="w-full text-text-primary title-2xl-semi-bold">
                  {t('overview.appInfo.regenerate', { ns: 'appOverview' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full whitespace-pre-wrap break-words text-text-tertiary system-md-regular">
                  {t('overview.appInfo.regenerateNotice', { ns: 'appOverview' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton disabled={genLoading} onClick={onCloseRegenerateDialog}>
                  {t('operation.cancel', { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton loading={genLoading} disabled={genLoading} onClick={onConfirmRegenerate}>
                  {t('operation.confirm', { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  )
}

export const AppCardAccessSection = ({
  iconClassName,
  isAppAccessSet,
  label,
  onClick,
}: AppCardAccessSectionProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-start justify-center self-stretch">
      <div className="pb-1 text-text-tertiary system-xs-medium">{t('publishApp.title', { ns: 'app' })}</div>
      <div
        className="flex h-9 w-full cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pl-2.5 pr-2"
        onClick={onClick}
      >
        <div className="flex grow items-center gap-x-1.5 pr-1">
          <span className={cn(iconClassName, 'h-4 w-4 shrink-0 text-text-secondary')} aria-hidden="true" />
          <p className="text-text-secondary system-sm-medium">{label}</p>
        </div>
        {!isAppAccessSet && <p className="shrink-0 text-text-tertiary system-xs-regular">{t('publishApp.notSet', { ns: 'app' })}</p>}
        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
          <span className="i-ri-arrow-right-s-line h-4 w-4 text-text-quaternary" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

export const AppCardOperations = ({
  appId,
  isApp,
  operations,
  onOperationSelect,
}: AppCardOperationsProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-1 self-stretch p-3">
      {!isApp && <SecretKeyButton appId={appId} />}
      {operations.map(operation => (
        <Button
          className="mr-1 min-w-[88px]"
          size="small"
          variant="ghost"
          key={operation.key}
          onClick={() => onOperationSelect(operation.key)}
          disabled={operation.disabled}
        >
          {operation.disabled
            ? (
                <Tooltip>
                  {renderTooltipTrigger(
                    <div className="flex items-center justify-center gap-[1px]">
                      <span className={cn(operation.iconClassName, 'h-3.5 w-3.5')} aria-hidden="true" />
                      <div className="px-[3px] text-components-button-ghost-text-disabled system-xs-medium">{operation.label}</div>
                    </div>,
                  )}
                  <TooltipContent popupClassName="mt-[-8px]">
                    {t('overview.appInfo.preUseReminder', { ns: 'appOverview' })}
                  </TooltipContent>
                </Tooltip>
              )
            : (
                <div className="flex items-center justify-center gap-[1px]">
                  <span className={cn(operation.iconClassName, 'h-3.5 w-3.5')} aria-hidden="true" />
                  <div className="px-[3px] text-text-tertiary system-xs-medium">{operation.label}</div>
                </div>
              )}
        </Button>
      ))}
    </div>
  )
}
