'use client'

import type { SelectorParam } from 'i18next'
import type { AccessPointAppInfo } from './utils'
import type { ConfigParams } from '@/app/components/app/overview/settings'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessControl from '@/app/components/app/app-access-control'
import CustomizeModal from '@/app/components/app/overview/customize'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import SettingsModal from '@/app/components/app/overview/settings'
import AppIcon from '@/app/components/base/app-icon'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control/use-app-access-control'
import { AppModeEnum } from '@/types/app'
import { AccessPointCard } from './access-point-card'
import { AccessPointUrl } from './access-point-url'
import { getBuiltInAccessUrls } from './utils'

type Availability = 'available' | 'loading' | 'unavailable'
const ACCESS_MODE_ICON_MAP: Record<AccessMode, string> = {
  [AccessMode.ORGANIZATION]: 'i-ri-building-line',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'i-ri-lock-line',
  [AccessMode.PUBLIC]: 'i-ri-global-line',
  [AccessMode.EXTERNAL_MEMBERS]: 'i-ri-verified-badge-line',
}

const ACCESS_MODE_LABEL_MAP: Record<AccessMode, SelectorParam<'app'>> = {
  [AccessMode.ORGANIZATION]: ($) => $['accessControlDialog.accessItems.organization'],
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: ($) => $['accessControlDialog.accessItems.specific'],
  [AccessMode.PUBLIC]: ($) => $['accessControlDialog.accessItems.anyone'],
  [AccessMode.EXTERNAL_MEMBERS]: ($) => $['accessControlDialog.accessItems.external'],
}

type WebAppAccessPointCardProps = {
  appInfo: AccessPointAppInfo
  availability: Availability
  canEdit: boolean
  canDeploy: boolean
  canManageAccess: boolean
  showAccessControl: boolean
  onChangeStatus: (enabled: boolean) => Promise<void>
  onRefreshApp: () => Promise<void>
  onRegenerate: () => Promise<void>
  onSaveSiteConfig: (params: ConfigParams) => Promise<void>
}

export function WebAppAccessPointCard({
  appInfo,
  availability,
  canEdit,
  canDeploy,
  canManageAccess,
  onChangeStatus,
  onRefreshApp,
  onRegenerate,
  onSaveSiteConfig,
  showAccessControl,
}: WebAppAccessPointCardProps) {
  const { t } = useTranslation()
  const [showSettings, setShowSettings] = useState(false)
  const [showEmbedded, setShowEmbedded] = useState(false)
  const [showCustomize, setShowCustomize] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [showRegenerate, setShowRegenerate] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const { webApp: webAppUrl } = getBuiltInAccessUrls(appInfo)
  const running = availability === 'available' && appInfo.enable_site
  const accessIcon = ACCESS_MODE_ICON_MAP[appInfo.access_mode]
  const accessLabel = ACCESS_MODE_LABEL_MAP[appInfo.access_mode]
  const { data: accessSubjects } = useAppWhiteListSubjects(
    appInfo.id,
    showAccessControl &&
      canManageAccess &&
      appInfo.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  const accessConfigured =
    !accessSubjects ||
    appInfo.access_mode !== AccessMode.SPECIFIC_GROUPS_MEMBERS ||
    Boolean(accessSubjects?.groups?.length || accessSubjects?.members?.length)

  const handleRegenerate = async () => {
    setRegenerating(true)
    await onRegenerate()
    setRegenerating(false)
    setShowRegenerate(false)
  }

  const status = availability !== 'available' ? 'unavailable' : running ? 'inService' : 'disabled'
  const statusLabel =
    availability !== 'available'
      ? t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], { ns: 'deployments' })
      : running
        ? t(($) => $['agentDetail.access.status.inService'], { ns: 'agentV2' })
        : t(($) => $['overview.status.disable'], { ns: 'appOverview' })

  return (
    <>
      <AccessPointCard
        title={t(($) => $['agentDetail.access.webApp.title'], { ns: 'agentV2' })}
        description={t(($) => $['studio.accessPoint.webAppDescription'], {
          ns: 'deployments',
        })}
        icon={
          <AppIcon
            size="large"
            iconType={appInfo.icon_type}
            icon={appInfo.icon}
            background={appInfo.icon_background}
            imageUrl={appInfo.icon_url}
          />
        }
        status={status}
        statusLabel={statusLabel}
        switchDisabled={!canEdit}
        switchLabel={t(($) => $['overview.appInfo.title'], { ns: 'appOverview' })}
        onEnabledChange={availability === 'available' ? onChangeStatus : undefined}
        actions={
          <>
            {appInfo.mode !== AppModeEnum.WORKFLOW && (
              <Button
                className="flex items-center gap-1 px-3"
                variant="secondary"
                disabled={!running}
                onClick={() => setShowEmbedded(true)}
              >
                <span aria-hidden className="i-ri-window-line size-4" />
                {t(($) => $['studio.accessPoint.embedIntoSite'], { ns: 'deployments' })}
              </Button>
            )}
            <Button
              className="flex items-center gap-1 px-3"
              variant="secondary"
              disabled={!running}
              onClick={() => setShowCustomize(true)}
            >
              <span aria-hidden className="i-custom-vender-deploy-code-block size-4" />
              {t(($) => $['overview.appInfo.customize.entry'], {
                ns: 'appOverview',
              })}
            </Button>
            <Button
              className="flex items-center gap-1 px-3"
              variant="secondary"
              disabled={availability !== 'available' || !canEdit}
              onClick={() => setShowSettings(true)}
            >
              <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              {t(($) => $['settings.settings'], { ns: 'common' })}
            </Button>
          </>
        }
      >
        <AccessPointUrl
          label={t(($) => $['agentDetail.access.webApp.accessUrl'], { ns: 'agentV2' })}
          value={webAppUrl}
          enabled={running}
          loading={availability === 'loading'}
          unavailable={availability === 'unavailable'}
          unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
            ns: 'deployments',
          })}
          showOpen
          showQrCode
          showRegenerate
          openLabel={t(($) => $['studio.accessPoint.open'], { ns: 'deployments' })}
          regenerateLabel={t(($) => $['overview.appInfo.regenerate'], {
            ns: 'appOverview',
          })}
          regenerateDisabled={!canEdit}
          regenerating={regenerating}
          onOpen={() => window.open(webAppUrl, '_blank')}
          onRegenerate={() => setShowRegenerate(true)}
        />
        {showAccessControl && (
          <div className="px-4 pb-3">
            {availability === 'available' ? (
              <button
                type="button"
                className="flex h-9 w-full items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pr-2 pl-2.5 text-left outline-hidden hover:bg-components-input-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:hover:bg-components-input-bg-normal"
                disabled={!canManageAccess}
                onClick={() => setShowAccess(true)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-x-1.5 pr-1">
                  <span
                    aria-hidden
                    className={`${accessIcon} size-4 shrink-0 text-text-tertiary`}
                  />
                  <span className="truncate system-xs-regular text-text-tertiary">
                    {t(accessLabel, { ns: 'app' })}
                  </span>
                </span>
                {!accessConfigured && (
                  <span className="shrink-0 system-xs-regular text-text-tertiary">
                    {t(($) => $['publishApp.notSet'], { ns: 'app' })}
                  </span>
                )}
                <span
                  aria-hidden
                  className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-quaternary"
                />
              </button>
            ) : (
              <div className="flex h-9 w-full items-center gap-2 rounded-lg border-[0.5px] border-divider-subtle bg-components-input-bg-normal px-2.5">
                <span aria-hidden className="i-ri-global-line size-4 shrink-0 text-text-disabled" />
                <span className="h-2 w-[42%] rounded-full bg-text-quaternary opacity-10" />
                <span
                  aria-hidden
                  className="ml-auto i-ri-arrow-right-s-line size-4 shrink-0 text-text-disabled"
                />
              </div>
            )}
          </div>
        )}
      </AccessPointCard>

      <SettingsModal
        isChat={appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW}
        canDeploy={canDeploy}
        appInfo={appInfo}
        isShow={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={onSaveSiteConfig}
      />
      {appInfo.mode !== AppModeEnum.WORKFLOW && (
        <EmbeddedModal
          siteInfo={appInfo.site}
          isShow={showEmbedded}
          onClose={() => setShowEmbedded(false)}
          appBaseUrl={appInfo.site?.app_base_url}
          accessToken={appInfo.site?.access_token}
        />
      )}
      <CustomizeModal
        isShow={showCustomize}
        onClose={() => setShowCustomize(false)}
        appId={appInfo.id}
        api_base_url={appInfo.api_base_url}
        mode={appInfo.mode}
      />
      {showAccess && (
        <AccessControl
          app={appInfo}
          onClose={() => setShowAccess(false)}
          onConfirm={async () => {
            await onRefreshApp()
            setShowAccess(false)
          }}
        />
      )}
      <AlertDialog open={showRegenerate} onOpenChange={(open) => !open && setShowRegenerate(false)}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['overview.appInfo.regenerate'], { ns: 'appOverview' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-tertiary">
              {t(($) => $['overview.appInfo.regenerateNotice'], { ns: 'appOverview' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={() => void handleRegenerate()}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
