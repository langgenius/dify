/* eslint-disable react-refresh/only-export-components */
import type { TFunction } from 'i18next'
import type { ComponentType, ReactNode } from 'react'
import type { OverviewOperationKey } from './app-card-utils'
import type { ConfigParams } from './settings'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { RiArrowRightSLine, RiBookOpenLine, RiBuildingLine, RiEqualizer2Line, RiExternalLinkLine, RiGlobalLine, RiLockLine, RiPaintBrushLine, RiVerifiedBadgeLine, RiWindowLine } from '@remixicon/react'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Divider from '@/app/components/base/divider'
import ShareQRCode from '@/app/components/base/qrcode'
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/base/ui/tooltip'
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
}: {
  t: TFunction
  operations: AppCardOperation[]
}) => (
  <>
    {operations.map(({ key, label, Icon, disabled, onClick }) => (
      <Button
        className="mr-1 min-w-[88px]"
        size="small"
        variant="ghost"
        key={key}
        onClick={onClick}
        disabled={disabled}
      >
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
      </Button>
    ))}
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
