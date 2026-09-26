'use client'

import type {
  AppDetailWithSite,
  AppSiteUpdatePayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { SelectorParam } from 'i18next'
import type { PublishedWorkflow } from '../shared/utils'
import type { AccessPointAvailability } from '@/app/components/base/access-point/status'
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
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessControl from '@/app/components/app/app-access-control'
import CustomizeModal from '@/app/components/app/overview/customize'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import SettingsModal from '@/app/components/app/overview/settings'
import { WorkflowLaunchDialog } from '@/app/components/app/overview/workflow-launch-dialog'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { getAccessPointStatus } from '@/app/components/base/access-point/status'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import AppIcon from '@/app/components/base/app-icon'
import { toast } from '@/app/notifications'
import { AccessMode } from '@/models/access-control'
import {
  useAppWhiteListSubjects,
  useGetUserCanAccessApp,
} from '@/service/access-control/use-app-access-control'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'
import { useAccessPointStatusLabel } from '../shared/use-access-point-status-label'
import { getBuiltInAccessUrls, getHiddenStartInputs } from '../shared/utils'
import {
  WebAppAccessControlEntry,
  WebAppAccessControlEntrySkeleton,
} from '../shared/web-app-access-control'

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
  appInfo: AppDetailWithSite
  availability: AccessPointAvailability
  canDeploy: boolean
  canManageAccessPoint: boolean
  highlighted?: boolean
  showAccessControl: boolean
  onSaveSiteConfig: (params: AppSiteUpdatePayload) => Promise<void>
  workflow: PublishedWorkflow
}

export function WebAppAccessPointCard({
  appInfo,
  availability,
  canDeploy,
  canManageAccessPoint,
  highlighted,
  onSaveSiteConfig,
  showAccessControl,
  workflow,
}: WebAppAccessPointCardProps) {
  const { t } = useTranslation([
    'agentV2',
    'app',
    'appOverview',
    'common',
    'deployments',
    'navigation',
  ])
  const [showSettings, setShowSettings] = useState(false)
  const [showEmbedded, setShowEmbedded] = useState(false)
  const [showCustomize, setShowCustomize] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [showRegenerate, setShowRegenerate] = useState(false)
  const [showWorkflowLaunch, setShowWorkflowLaunch] = useState(false)
  const toggleSiteMutation = useMutation(
    consoleQuery.apps.byAppId.siteEnable.post.mutationOptions({
      scope: {
        id: `app-web-app-toggle:${appInfo.id}`,
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const resetSiteAccessToken = useMutation(
    consoleQuery.apps.byAppId.site.accessTokenReset.post.mutationOptions({
      onSuccess: () => {
        setShowRegenerate(false)
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.generatedUnsuccessfully'], { ns: 'common' }))
        setShowRegenerate(false)
      },
    }),
  )
  const site = appInfo.site
  const siteAvailability = site ? availability : 'unavailable'
  const { webApp: webAppUrl } = getBuiltInAccessUrls(appInfo)
  const pendingEnabled = toggleSiteMutation.variables?.body.enable_site
  const optimisticEnabled =
    toggleSiteMutation.isPending && pendingEnabled !== undefined
      ? pendingEnabled
      : appInfo.enable_site
  const running = siteAvailability === 'available' && optimisticEnabled
  const actionsAvailable = running && Boolean(webAppUrl) && !toggleSiteMutation.isPending
  const supportsEmbedded =
    appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW
  const hiddenLaunchVariables = getHiddenStartInputs(workflow)
  const { data: accessSubjects } = useAppWhiteListSubjects(
    appInfo.id,
    showAccessControl &&
      canManageAccessPoint &&
      appInfo.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  const accessConfigured =
    !accessSubjects ||
    appInfo.access_mode !== AccessMode.SPECIFIC_GROUPS_MEMBERS ||
    Boolean(accessSubjects?.groups?.length || accessSubjects?.members?.length)
  const { data: userCanAccessApp, refetch: refetchUserCanAccessApp } = useGetUserCanAccessApp({
    appId: appInfo.id,
    enabled: showAccessControl,
  })
  const noAccessPermission =
    showAccessControl &&
    (appInfo.access_mode === null ||
      (appInfo.access_mode !== AccessMode.EXTERNAL_MEMBERS && !userCanAccessApp?.result))

  const handleRegenerate = () => {
    if (!canManageAccessPoint || resetSiteAccessToken.isPending) return

    resetSiteAccessToken.mutate({ params: { app_id: appInfo.id } })
  }

  const handleEnabledChange = (enabled: boolean) => {
    if (!canManageAccessPoint) return

    toggleSiteMutation.mutate({
      params: {
        app_id: appInfo.id,
      },
      body: {
        enable_site: enabled,
      },
    })
  }

  const status = getAccessPointStatus(siteAvailability, running)
  const statusLabel = useAccessPointStatusLabel(status)

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
            icon={appInfo.icon ?? undefined}
            background={appInfo.icon_background}
            imageUrl={appInfo.icon_url}
          />
        }
        status={status}
        statusLabel={statusLabel}
        highlighted={highlighted}
        switchDisabled={!canManageAccessPoint}
        switchLabel={t(($) => $['overview.appInfo.title'], { ns: 'appOverview' })}
        onEnabledChange={siteAvailability === 'available' ? handleEnabledChange : undefined}
        actions={
          <>
            {hiddenLaunchVariables.length > 0 && (
              <Button
                className="flex items-center gap-1 px-3"
                variant="secondary"
                disabled={!actionsAvailable || !canManageAccessPoint}
                onClick={() => setShowWorkflowLaunch(true)}
              >
                <span aria-hidden className="i-ri-settings-2-line size-4" />
                {t(($) => $['operation.config'], { ns: 'common' })}
              </Button>
            )}
            {supportsEmbedded && (
              <Button
                className="flex items-center gap-1 px-3"
                variant="secondary"
                disabled={!actionsAvailable || !canManageAccessPoint}
                onClick={() => setShowEmbedded(true)}
              >
                <span aria-hidden className="i-ri-window-line size-4" />
                {t(($) => $['studio.accessPoint.embedIntoSite'], { ns: 'deployments' })}
              </Button>
            )}
            <Button
              className="flex items-center gap-1 px-3"
              variant="secondary"
              disabled={!actionsAvailable || !canManageAccessPoint}
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
              disabled={siteAvailability !== 'available' || !canManageAccessPoint}
              onClick={() => setShowSettings(true)}
            >
              <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              {t(($) => $['settings.settings'], { ns: 'navigation' })}
            </Button>
          </>
        }
      >
        <AccessPointUrl
          label={t(($) => $['agentDetail.access.webApp.accessUrl'], { ns: 'agentV2' })}
          value={webAppUrl}
          enabled={running}
          loading={siteAvailability === 'loading'}
          unavailable={siteAvailability === 'unavailable'}
          unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
            ns: 'deployments',
          })}
          showOpen
          showQrCode
          showRegenerate
          openLabel={t(($) => $['studio.accessPoint.open'], { ns: 'deployments' })}
          openDisabledReason={
            noAccessPermission ? t(($) => $.noAccessPermission, { ns: 'app' }) : undefined
          }
          openUrl={actionsAvailable && !noAccessPermission ? webAppUrl : undefined}
          regenerateLabel={t(($) => $['overview.appInfo.regenerate'], {
            ns: 'appOverview',
          })}
          regenerateDisabled={!site || !canManageAccessPoint}
          regenerating={resetSiteAccessToken.isPending}
          onRegenerate={() => setShowRegenerate(true)}
        />
        {showAccessControl &&
          (siteAvailability === 'available' && appInfo.access_mode !== null ? (
            <WebAppAccessControlEntry
              accessConfigured={accessConfigured}
              accessIcon={ACCESS_MODE_ICON_MAP[appInfo.access_mode]}
              accessLabel={t(ACCESS_MODE_LABEL_MAP[appInfo.access_mode], { ns: 'app' })}
              disabled={!canManageAccessPoint}
              onClick={() => setShowAccess(true)}
            />
          ) : (
            <WebAppAccessControlEntrySkeleton loading={siteAvailability === 'loading'} />
          ))}
      </AccessPointCard>

      {site && (
        <SettingsModal
          isChat={appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW}
          canDeploy={canDeploy}
          appInfo={{ id: appInfo.id, mode: appInfo.mode, site }}
          isShow={showSettings}
          onClose={() => setShowSettings(false)}
          onSave={onSaveSiteConfig}
        />
      )}
      {supportsEmbedded && site?.access_token && (
        <EmbeddedModal
          siteInfo={site}
          isShow={showEmbedded}
          onClose={() => setShowEmbedded(false)}
          appBaseUrl={site.app_base_url}
          accessToken={site.access_token}
          hiddenInputs={hiddenLaunchVariables}
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
            await refetchUserCanAccessApp()
            setShowAccess(false)
          }}
        />
      )}
      <WorkflowLaunchDialog
        hiddenVariables={hiddenLaunchVariables}
        launchDisabled={noAccessPermission}
        open={showWorkflowLaunch}
        targetUrl={webAppUrl}
        onOpenChange={setShowWorkflowLaunch}
      />
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
            <AlertDialogConfirmButton
              disabled={resetSiteAccessToken.isPending}
              onClick={handleRegenerate}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
