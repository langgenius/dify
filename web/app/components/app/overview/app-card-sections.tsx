/* eslint-disable react-refresh/only-export-components */
import type { TFunction } from 'i18next'
import type { ChangeEvent, ComponentType, FormEvent, ReactNode } from 'react'
import type {
  OverviewOperationKey,
  WorkflowHiddenStartVariable,
  WorkflowLaunchInputValue,
} from './app-card-utils'
import type { ConfigParams } from './settings'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { RiArrowRightSLine, RiBookOpenLine, RiBuildingLine, RiEqualizer2Line, RiExternalLinkLine, RiGlobalLine, RiLockLine, RiPaintBrushLine, RiVerifiedBadgeLine, RiWindowLine } from '@remixicon/react'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import ShareQRCode from '@/app/components/base/qrcode'
import Textarea from '@/app/components/base/textarea'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { Button } from '@/app/components/base/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/app/components/base/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/base/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/base/ui/tooltip'
import { InputVarType } from '@/app/components/workflow/types'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import AccessControl from '../app-access-control'
import CustomizeModal from './customize'
import EmbeddedModal from './embedded'
import SettingsModal from './settings'
import style from './style.module.css'

type AppInfo = AppDetailResponse & Partial<AppSSO>

type OperationIcon = ComponentType<{ className?: string }>

type AccessModeLabelKey
  = | 'accessControlDialog.accessItems.organization'
    | 'accessControlDialog.accessItems.specific'
    | 'accessControlDialog.accessItems.anyone'
    | 'accessControlDialog.accessItems.external'

type AppCardOperation = {
  key: OverviewOperationKey
  label: string
  Icon: OperationIcon
  disabled: boolean
  onClick: () => void
}

type LaunchConfigAction = {
  label: string
  disabled: boolean
  onClick: () => void
}

const OPERATION_ICON_MAP: Record<OverviewOperationKey, OperationIcon> = {
  launch: RiExternalLinkLine,
  embedded: RiWindowLine,
  customize: RiPaintBrushLine,
  settings: RiEqualizer2Line,
  develop: RiBookOpenLine,
}

const ACCESS_MODE_ICON_MAP: Record<AccessMode, OperationIcon> = {
  [AccessMode.ORGANIZATION]: RiBuildingLine,
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: RiLockLine,
  [AccessMode.PUBLIC]: RiGlobalLine,
  [AccessMode.EXTERNAL_MEMBERS]: RiVerifiedBadgeLine,
}

const ACCESS_MODE_LABEL_MAP: Record<AccessMode, AccessModeLabelKey> = {
  [AccessMode.ORGANIZATION]: 'accessControlDialog.accessItems.organization',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'accessControlDialog.accessItems.specific',
  [AccessMode.PUBLIC]: 'accessControlDialog.accessItems.anyone',
  [AccessMode.EXTERNAL_MEMBERS]: 'accessControlDialog.accessItems.external',
}

const MaybeTooltip = ({
  children,
  content,
  tooltipClassName,
  show = true,
}: {
  children: ReactNode
  content?: ReactNode
  tooltipClassName?: string
  show?: boolean
}) => {
  if (!show || !content)
    return <>{children}</>

  return (
    <Tooltip>
      <TooltipTrigger render={<div>{children}</div>} />
      <TooltipContent className={tooltipClassName}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export const WorkflowLaunchDialog = ({
  t,
  open,
  hiddenVariables,
  unsupportedVariables,
  values,
  onOpenChange,
  onValueChange,
  onSubmit,
}: {
  t: TFunction
  open: boolean
  hiddenVariables: WorkflowHiddenStartVariable[]
  unsupportedVariables: WorkflowHiddenStartVariable[]
  values: Record<string, WorkflowLaunchInputValue>
  onOpenChange: (open: boolean) => void
  onValueChange: (variable: string, value: WorkflowLaunchInputValue) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) => {
  const renderField = (variable: WorkflowHiddenStartVariable) => {
    const fieldId = `workflow-launch-hidden-input-${variable.variable}`
    const fieldValue = values[variable.variable]
    const label = typeof variable.label === 'string' ? variable.label : variable.variable

    if (variable.type === InputVarType.select) {
      return (
        <Select
          value={typeof fieldValue === 'string' ? fieldValue : ''}
          onValueChange={value => onValueChange(variable.variable, value ?? '')}
        >
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue placeholder={label} />
          </SelectTrigger>
          <SelectContent>
            {(variable.options ?? []).map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (variable.type === InputVarType.checkbox) {
      return (
        <label className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg bg-components-input-bg-normal px-3 py-2">
          <input
            id={fieldId}
            type="checkbox"
            checked={Boolean(fieldValue)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(variable.variable, event.target.checked)}
            className="h-4 w-4 rounded border-divider-subtle"
          />
          <span className="system-sm-regular text-text-secondary">{label}</span>
        </label>
      )
    }

    if (
      variable.type === InputVarType.paragraph
      || variable.type === InputVarType.json
      || variable.type === InputVarType.jsonObject
    ) {
      return (
        <Textarea
          id={fieldId}
          value={typeof fieldValue === 'string' ? fieldValue : ''}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onValueChange(variable.variable, event.target.value)}
          placeholder={label}
          maxLength={variable.max_length}
          className="min-h-24"
        />
      )
    }

    return (
      <Input
        id={fieldId}
        type={variable.type === InputVarType.number ? 'number' : 'text'}
        value={typeof fieldValue === 'string' ? fieldValue : ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(variable.variable, event.target.value)}
        placeholder={label}
        maxLength={variable.max_length}
      />
    )
  }

  if (!hiddenVariables.length && !unsupportedVariables.length)
    return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[560px]! max-w-[calc(100vw-2rem)]! p-0!">
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('overview.appInfo.workflowLaunchHiddenInputs.title', { ns: 'appOverview' })}
          </DialogTitle>
          <DialogDescription className="system-md-regular text-text-tertiary">
            {t('overview.appInfo.workflowLaunchHiddenInputs.description', { ns: 'appOverview' })}
          </DialogDescription>
        </div>
        <form onSubmit={onSubmit}>
          <div className="space-y-4 px-6 pb-4">
            {hiddenVariables.map(variable => (
              <div key={variable.variable} className="space-y-1.5">
                {variable.type !== InputVarType.checkbox && (
                  <label
                    htmlFor={`workflow-launch-hidden-input-${variable.variable}`}
                    className="block system-sm-medium text-text-secondary"
                  >
                    {typeof variable.label === 'string' ? variable.label : variable.variable}
                  </label>
                )}
                {renderField(variable)}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
            <Button onClick={() => onOpenChange(false)}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" variant="primary">
              {t('overview.appInfo.launch', { ns: 'appOverview' })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export const createAppCardOperations = ({
  operationKeys,
  t,
  runningStatus,
  triggerModeDisabled,
  onLaunch,
  onEmbedded,
  onCustomize,
  onSettings,
  onDevelop,
}: {
  operationKeys: OverviewOperationKey[]
  t: TFunction
  runningStatus: boolean
  triggerModeDisabled: boolean
  onLaunch: () => void
  onEmbedded: () => void
  onCustomize: () => void
  onSettings: () => void
  onDevelop: () => void
}): AppCardOperation[] => {
  const labelMap: Record<OverviewOperationKey, string> = {
    launch: t('overview.appInfo.launch', { ns: 'appOverview' }),
    embedded: t('overview.appInfo.embedded.entry', { ns: 'appOverview' }),
    customize: t('overview.appInfo.customize.entry', { ns: 'appOverview' }),
    settings: t('overview.appInfo.settings.entry', { ns: 'appOverview' }),
    develop: t('overview.apiInfo.doc', { ns: 'appOverview' }),
  }
  const onClickMap: Record<OverviewOperationKey, () => void> = {
    launch: onLaunch,
    embedded: onEmbedded,
    customize: onCustomize,
    settings: onSettings,
    develop: onDevelop,
  }

  return operationKeys.map((key) => {
    const disabled = triggerModeDisabled ? true : (key === 'settings' ? false : !runningStatus)
    return {
      key,
      label: labelMap[key],
      Icon: OPERATION_ICON_MAP[key],
      disabled,
      onClick: onClickMap[key],
    }
  })
}

export const AppCardUrlSection = ({
  t,
  isApp,
  accessibleUrl,
  showConfirmDelete,
  isCurrentWorkspaceManager,
  genLoading,
  onRegenerate,
  onShowRegenerateConfirm,
  onHideRegenerateConfirm,
}: {
  t: TFunction
  isApp: boolean
  accessibleUrl: string
  showConfirmDelete: boolean
  isCurrentWorkspaceManager: boolean
  genLoading: boolean
  onRegenerate: () => void
  onShowRegenerateConfirm: () => void
  onHideRegenerateConfirm: () => void
}) => (
  <div className="flex flex-col items-start justify-center self-stretch">
    <div className="pb-1 system-xs-medium text-text-tertiary">
      {isApp
        ? t('overview.appInfo.accessibleAddress', { ns: 'appOverview' })
        : t('overview.apiInfo.accessibleAddress', { ns: 'appOverview' })}
    </div>
    <div className="inline-flex h-9 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
      <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
        <div className="overflow-hidden text-xs font-medium text-ellipsis whitespace-nowrap text-text-secondary">
          {accessibleUrl}
        </div>
      </div>
      <CopyFeedback content={accessibleUrl} className="size-6!" />
      {isApp && <ShareQRCode content={accessibleUrl} />}
      {isApp && <Divider type="vertical" className="mx-0.5! h-3.5! shrink-0" />}
      <AlertDialog open={showConfirmDelete} onOpenChange={open => !open && onHideRegenerateConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col items-start gap-2 self-stretch pt-6 pr-6 pb-4 pl-6">
            <AlertDialogTitle className="w-full title-2xl-semi-bold text-text-primary">
              {t('overview.appInfo.regenerate', { ns: 'appOverview' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('overview.appInfo.regenerateNotice', { ns: 'appOverview' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton onClick={onHideRegenerateConfirm}>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={onRegenerate}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      {isApp && isCurrentWorkspaceManager && (
        <MaybeTooltip content={t('overview.appInfo.regenerate', { ns: 'appOverview' }) || ''}>
          <div
            className="h-6 w-6 cursor-pointer rounded-md hover:bg-state-base-hover"
            onClick={onShowRegenerateConfirm}
          >
            <div className={`h-full w-full ${style.refreshIcon} ${genLoading ? style.generateLogo : ''}`} />
          </div>
        </MaybeTooltip>
      )}
    </div>
  </div>
)

export const AppCardAccessControlSection = ({
  t,
  appDetail,
  isAppAccessSet,
  onClick,
}: {
  t: TFunction
  appDetail: AppDetailResponse
  isAppAccessSet: boolean
  onClick: () => void
}) => {
  const Icon = ACCESS_MODE_ICON_MAP[appDetail.access_mode]
  const labelKey = ACCESS_MODE_LABEL_MAP[appDetail.access_mode]

  return (
    <div className="flex flex-col items-start justify-center self-stretch">
      <div className="pb-1 system-xs-medium text-text-tertiary">{t('publishApp.title', { ns: 'app' })}</div>
      <div
        className="flex h-9 w-full cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pr-2 pl-2.5"
        onClick={onClick}
      >
        <div className="flex grow items-center gap-x-1.5 pr-1">
          <Icon className="h-4 w-4 shrink-0 text-text-secondary" />
          <p className="system-sm-medium text-text-secondary">{t(labelKey, { ns: 'app' })}</p>
        </div>
        {!isAppAccessSet && <p className="shrink-0 system-xs-regular text-text-tertiary">{t('publishApp.notSet', { ns: 'app' })}</p>}
        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
          <RiArrowRightSLine className="h-4 w-4 text-text-quaternary" />
        </div>
      </div>
    </div>
  )
}

export const AppCardOperations = ({
  t,
  operations,
  launchConfigAction,
}: {
  t: TFunction
  operations: AppCardOperation[]
  launchConfigAction?: LaunchConfigAction
}) => (
  <>
    {operations.map(({ key, label, Icon, disabled, onClick }) => {
      const buttonContent = (
        <MaybeTooltip
          content={t('overview.appInfo.preUseReminder', { ns: 'appOverview' }) ?? ''}
          tooltipClassName="mt-[-8px]"
          show={disabled}
        >
          <div className="flex items-center justify-center gap-px">
            <Icon className="h-3.5 w-3.5" />
            <div className={`${disabled ? 'text-components-button-ghost-text-disabled' : 'text-text-tertiary'} px-[3px] system-xs-medium`}>{label}</div>
          </div>
        </MaybeTooltip>
      )

      if (key === 'launch' && launchConfigAction) {
        return (
          <MaybeTooltip
            key={key}
            content={t('overview.appInfo.preUseReminder', { ns: 'appOverview' }) ?? ''}
            tooltipClassName="mt-[-8px]"
            show={disabled}
          >
            <Button
              className="mr-1 border-0 px-0 py-0 shadow-none backdrop-blur-none hover:bg-components-button-secondary-bg"
              size="small"
              variant="secondary"
              onClick={onClick}
              disabled={disabled}
            >
              <div className="flex h-full min-w-[88px] items-center justify-center rounded-l-md px-2 hover:bg-components-button-secondary-bg-hover">
                <div className="flex items-center justify-center gap-px">
                  <Icon className="h-3.5 w-3.5" />
                  <div className="px-[3px] system-xs-medium">{label}</div>
                </div>
              </div>
              <div
                aria-hidden="true"
                className="h-4 w-px shrink-0 bg-divider-regular opacity-100"
              />
              <div
                className="flex h-full w-8 shrink-0 items-center justify-center rounded-r-md hover:bg-components-button-secondary-bg-hover"
                onClick={(event) => {
                  event.stopPropagation()
                  launchConfigAction.onClick()
                }}
                aria-label={launchConfigAction.label}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onKeyDown={(event) => {
                  if (disabled)
                    return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    launchConfigAction.onClick()
                  }
                }}
              >
                <RiEqualizer2Line className="h-3.5 w-3.5" />
              </div>
            </Button>
          </MaybeTooltip>
        )
      }

      return (
        <Button
          className="mr-1 min-w-[88px]"
          size="small"
          variant="ghost"
          key={key}
          onClick={onClick}
          disabled={disabled}
        >
          {buttonContent}
        </Button>
      )
    })}
  </>
)

export const AppCardDialogs = ({
  isApp,
  appInfo,
  appMode,
  showSettingsModal,
  showEmbedded,
  showCustomizeModal,
  showAccessControl,
  appDetail,
  onCloseSettings,
  onCloseEmbedded,
  onCloseCustomize,
  onCloseAccessControl,
  onSaveSiteConfig,
  onConfirmAccessControl,
}: {
  isApp: boolean
  appInfo: AppInfo
  appMode: AppModeEnum
  showSettingsModal: boolean
  showEmbedded: boolean
  showCustomizeModal: boolean
  showAccessControl: boolean
  appDetail: AppDetailResponse | null | undefined
  onCloseSettings: () => void
  onCloseEmbedded: () => void
  onCloseCustomize: () => void
  onCloseAccessControl: () => void
  onSaveSiteConfig?: (params: ConfigParams) => Promise<void>
  onConfirmAccessControl: () => Promise<void>
}) => {
  if (!isApp)
    return null

  return (
    <>
      <SettingsModal
        isChat={appMode === AppModeEnum.CHAT}
        appInfo={appInfo}
        isShow={showSettingsModal}
        onClose={onCloseSettings}
        onSave={onSaveSiteConfig}
      />
      <EmbeddedModal
        siteInfo={appInfo.site}
        isShow={showEmbedded}
        onClose={onCloseEmbedded}
        appBaseUrl={appInfo.site?.app_base_url}
        accessToken={appInfo.site?.access_token}
      />
      <CustomizeModal
        isShow={showCustomizeModal}
        onClose={onCloseCustomize}
        appId={appInfo.id}
        api_base_url={appInfo.api_base_url}
        mode={appInfo.mode}
      />
      {showAccessControl && appDetail && (
        <AccessControl
          app={appDetail}
          onConfirm={onConfirmAccessControl}
          onClose={onCloseAccessControl}
        />
      )}
    </>
  )
}
