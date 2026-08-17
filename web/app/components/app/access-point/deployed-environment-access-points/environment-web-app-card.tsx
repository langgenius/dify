'use client'

import type { AccessPointAppInfo } from '../shared/utils'
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
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CustomizeModal from '@/app/components/app/overview/customize'
import SettingsModal from '@/app/components/app/overview/settings'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode, isAccessMode } from '@/models/access-control'
import { consoleQuery } from '@/service/client'
import { AccessPointCard } from '../shared/access-point-card'
import { AccessPointUrl } from '../shared/access-point-url'
import { useAccessPointActions } from '../shared/use-access-point-actions'
import { WebAppAccessControlEntry } from '../shared/web-app-access-control'
import { EnvironmentAccessControl } from './environment-access-control'
import { getEnvironmentWebAppUrl } from './environment-web-app-utils'

const ACCESS_MODE_ICON_MAP: Record<AccessMode, string> = {
  [AccessMode.ORGANIZATION]: 'i-ri-building-line',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'i-ri-lock-line',
  [AccessMode.EXTERNAL_MEMBERS]: 'i-ri-verified-badge-line',
  [AccessMode.PUBLIC]: 'i-ri-global-line',
}

type EnvironmentWebAppCardProps = {
  appId: string
  environmentId: string
  canEdit: boolean
  canManage: boolean
  highlighted?: boolean
}

export function EnvironmentWebAppCard({
  appId,
  environmentId,
  canEdit,
  canManage,
  highlighted,
}: EnvironmentWebAppCardProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const appInfo = useAppStore((state) => state.appDetail) as AccessPointAppInfo | null
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const actions = useAccessPointActions(appId, canEdit)
  const [showSettings, setShowSettings] = useState(false)
  const [showCustomize, setShowCustomize] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [showRegenerate, setShowRegenerate] = useState(false)
  const params = {
    app_id: appId,
    environment_id: environmentId,
  }
  const siteQueryOptions =
    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryOptions({
      input: { params },
    })
  const siteQuery = useQuery(siteQueryOptions)
  const site = siteQuery.data
  const siteAccessMode = site?.access_mode
  const apiQuery = useQuery(
    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryOptions({
      input: { params },
    }),
  )
  const accessMode = isAccessMode(siteAccessMode) ? siteAccessMode : AccessMode.ORGANIZATION
  const subjectsQueryOptions =
    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentWebAppSubjects.queryOptions({
      input: { params },
    })
  const subjectsQuery = useQuery({
    ...subjectsQueryOptions,
    enabled:
      siteQuery.isSuccess &&
      canManage &&
      (showAccess || accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS),
  })
  const accessConfigured =
    !subjectsQuery.data ||
    accessMode !== AccessMode.SPECIFIC_GROUPS_MEMBERS ||
    subjectsQuery.data.subjects.length > 0
  const siteMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.updateEnvironmentSite.mutationOptions({
      onSuccess: (updatedSite) => {
        queryClient.setQueryData(siteQueryOptions.queryKey, updatedSite)
        toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const resetAccessTokenMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.resetEnvironmentSiteAccessToken.mutationOptions(
      {
        onSuccess: (updatedSite) => {
          queryClient.setQueryData(siteQueryOptions.queryKey, updatedSite)
          setShowRegenerate(false)
          toast.success(t(($) => $['actionMsg.generatedSuccessfully'], { ns: 'common' }))
        },
        onError: () => {
          toast.error(t(($) => $['actionMsg.generatedUnsuccessfully'], { ns: 'common' }))
        },
      },
    ),
  )
  const webAppUrl = getEnvironmentWebAppUrl(site)
  const running = Boolean(siteQuery.isSuccess && site?.enabled)
  const status = siteQuery.isPending
    ? 'loading'
    : siteQuery.isError
      ? 'unavailable'
      : running
        ? 'inService'
        : 'disabled'
  const accessLabel =
    accessMode === AccessMode.ORGANIZATION
      ? t(($) => $['accessControlDialog.accessItems.organization'], { ns: 'app' })
      : accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS
        ? t(($) => $['accessControlDialog.accessItems.specific'], { ns: 'app' })
        : accessMode === AccessMode.EXTERNAL_MEMBERS
          ? t(($) => $['accessControlDialog.accessItems.external'], { ns: 'app' })
          : t(($) => $['accessControlDialog.accessItems.anyone'], { ns: 'app' })
  const handleEnabledChange = (enabled: boolean) => {
    if (!canManage) return

    siteMutation.mutate({
      params,
      body: { enabled },
    })
  }

  const handleRegenerate = () => {
    if (!canManage) return

    resetAccessTokenMutation.mutate({ params })
  }

  return (
    <>
      <AccessPointCard
        title={t(($) => $['agentDetail.access.webApp.title'], { ns: 'agentV2' })}
        description={t(($) => $['studio.accessPoint.webAppDescription'], {
          ns: 'deployments',
        })}
        icon={
          appInfo ? (
            <AppIcon
              size="large"
              iconType={appInfo.icon_type}
              icon={appInfo.icon}
              background={appInfo.icon_background}
              imageUrl={appInfo.icon_url}
            />
          ) : (
            'i-ri-robot-2-line'
          )
        }
        status={status}
        highlighted={highlighted}
        switchDisabled={!canManage}
        switchLabel={t(($) => $['overview.appInfo.title'], { ns: 'appOverview' })}
        onEnabledChange={siteQuery.isSuccess ? handleEnabledChange : undefined}
        busy={siteMutation.isPending}
        actions={
          <>
            <Button
              className="flex items-center gap-1 px-3"
              variant="secondary"
              disabled={!running || !apiQuery.isSuccess}
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
              disabled={!appInfo || !siteQuery.isSuccess || !canEdit}
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
          loading={siteQuery.isPending}
          unavailable={siteQuery.isError}
          unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
            ns: 'deployments',
          })}
          showOpen
          showQrCode
          showRegenerate
          openLabel={t(($) => $['studio.accessPoint.open'], { ns: 'deployments' })}
          openUrl={webAppUrl}
          regenerateLabel={t(($) => $['overview.appInfo.regenerate'], {
            ns: 'appOverview',
          })}
          regenerateDisabled={!canManage}
          regenerating={resetAccessTokenMutation.isPending}
          onRegenerate={() => setShowRegenerate(true)}
        />
        {systemFeatures.webapp_auth.enabled && (
          <WebAppAccessControlEntry
            accessConfigured={accessConfigured}
            accessIcon={ACCESS_MODE_ICON_MAP[accessMode]}
            accessLabel={accessLabel}
            available={siteQuery.isSuccess}
            disabled={!canManage}
            onClick={() => setShowAccess(true)}
          />
        )}
      </AccessPointCard>

      {appInfo && (
        <SettingsModal
          isChat={false}
          canDeploy={canManage}
          appInfo={appInfo}
          isShow={showSettings}
          onClose={() => setShowSettings(false)}
          onSave={actions.saveSiteConfig}
        />
      )}
      <CustomizeModal
        isShow={showCustomize}
        onClose={() => setShowCustomize(false)}
        appId={appId}
        api_base_url={apiQuery.data?.base_url ?? ''}
        mode={appInfo?.mode}
      />
      {showAccess && (
        <EnvironmentAccessControl
          appId={appId}
          environmentId={environmentId}
          accessMode={accessMode}
          canManage={canManage}
          onClose={() => setShowAccess(false)}
          onConfirm={() => setShowAccess(false)}
        />
      )}
      <AlertDialog open={showRegenerate} onOpenChange={setShowRegenerate}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['overview.appInfo.regenerate'], { ns: 'appOverview' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-tertiary">
              {t(($) => $['overview.appInfo.regenerateNotice'], {
                ns: 'appOverview',
              })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={resetAccessTokenMutation.isPending}
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
