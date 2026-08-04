'use client'

import type { EnvironmentWebAppSubject } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AccessPointAppInfo } from './utils'
import type { AccessControlAdapter } from '@/app/components/app/app-access-control'
import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessControl from '@/app/components/app/app-access-control'
import CustomizeModal from '@/app/components/app/overview/customize'
import SettingsModal from '@/app/components/app/overview/settings'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from '@/service/client'
import { AccessPointCard } from './access-point-card'
import { AccessPointUrl } from './access-point-url'
import { getEnvironmentWebAppUrl } from './environment-web-app-utils'
import { useBuiltInAccessPointActions } from './use-built-in-actions'

const ENVIRONMENT_ACCESS_MODES = [
  AccessMode.ORGANIZATION,
  AccessMode.SPECIFIC_GROUPS_MEMBERS,
  AccessMode.PUBLIC,
] as const satisfies readonly AccessMode[]

type EnvironmentAccessMode = (typeof ENVIRONMENT_ACCESS_MODES)[number]

const ACCESS_MODE_ICON_MAP: Record<EnvironmentAccessMode, string> = {
  [AccessMode.ORGANIZATION]: 'i-ri-building-line',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'i-ri-lock-line',
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
  const actions = useBuiltInAccessPointActions(appId, canEdit)
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
  const apiQuery = useQuery(
    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryOptions({
      input: { params },
    }),
  )
  const accessMode = normalizeEnvironmentAccessMode(site?.access_mode)
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
  const accessSubjects = useMemo(
    () =>
      subjectsQuery.data ? normalizeEnvironmentSubjects(subjectsQuery.data.subjects) : undefined,
    [subjectsQuery.data],
  )
  const accessConfigured =
    !accessSubjects ||
    accessMode !== AccessMode.SPECIFIC_GROUPS_MEMBERS ||
    Boolean(accessSubjects.groups.length || accessSubjects.members.length)
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
  const updateAccessModeMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.updateEnvironmentWebAppAccessMode.mutationOptions(
      {
        onSuccess: (updatedSite) => {
          queryClient.setQueryData(siteQueryOptions.queryKey, updatedSite)
          void queryClient.invalidateQueries({ queryKey: subjectsQueryOptions.queryKey })
        },
        onError: () => {
          toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
        },
      },
    ),
  )
  const webAppUrl = getEnvironmentWebAppUrl(environmentId, site)
  const running = Boolean(siteQuery.isSuccess && site?.enabled)
  const status = siteQuery.isSuccess ? (running ? 'inService' : 'disabled') : 'unavailable'
  const statusLabel = siteQuery.isSuccess
    ? running
      ? t(($) => $['agentDetail.access.status.inService'], { ns: 'agentV2' })
      : t(($) => $['overview.status.disable'], { ns: 'appOverview' })
    : t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], { ns: 'deployments' })
  const accessLabel =
    accessMode === AccessMode.ORGANIZATION
      ? t(($) => $['accessControlDialog.accessItems.organization'], { ns: 'app' })
      : accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS
        ? t(($) => $['accessControlDialog.accessItems.specific'], { ns: 'app' })
        : t(($) => $['accessControlDialog.accessItems.anyone'], { ns: 'app' })
  const accessControlAdapter: AccessControlAdapter = {
    subjectsQuery: {
      data: accessSubjects,
      isPending: subjectsQuery.isPending,
    },
    supportedModes: ENVIRONMENT_ACCESS_MODES,
    updatePending: updateAccessModeMutation.isPending,
    updateAccessMode: async ({ accessMode: nextAccessMode, subjects }) => {
      if (!canManage || !isEnvironmentAccessMode(nextAccessMode))
        throw new Error('Unsupported environment Web app access mode')

      await updateAccessModeMutation.mutateAsync({
        params,
        body: {
          access_mode: nextAccessMode,
          ...(nextAccessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS
            ? {
                subjects: (subjects ?? []).map((subject) => ({
                  subject_id: subject.subjectId,
                  subject_type: subject.subjectType,
                })),
              }
            : {}),
        },
      })
    },
  }

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
        statusLabel={statusLabel}
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
          regenerateLabel={t(($) => $['overview.appInfo.regenerate'], {
            ns: 'appOverview',
          })}
          regenerateDisabled={!canManage}
          regenerating={resetAccessTokenMutation.isPending}
          onOpen={() => window.open(webAppUrl, '_blank')}
          onRegenerate={() => setShowRegenerate(true)}
        />
        {systemFeatures.webapp_auth.enabled && (
          <div className="px-4 pb-3">
            {siteQuery.isSuccess ? (
              <button
                type="button"
                className="flex h-9 w-full items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pr-2 pl-2.5 text-left outline-hidden hover:bg-components-input-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:hover:bg-components-input-bg-normal"
                disabled={!canManage}
                onClick={() => setShowAccess(true)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-x-1.5 pr-1">
                  <span
                    aria-hidden
                    className={`${ACCESS_MODE_ICON_MAP[accessMode]} size-4 shrink-0 text-text-tertiary`}
                  />
                  <span className="truncate system-xs-regular text-text-tertiary">
                    {accessLabel}
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
        <AccessControl
          app={{ id: appId, access_mode: accessMode }}
          adapter={accessControlAdapter}
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

function isEnvironmentAccessMode(accessMode: AccessMode): accessMode is EnvironmentAccessMode {
  return ENVIRONMENT_ACCESS_MODES.some((mode) => mode === accessMode)
}

function normalizeEnvironmentAccessMode(accessMode?: string): EnvironmentAccessMode {
  if (accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS) return AccessMode.SPECIFIC_GROUPS_MEMBERS
  if (accessMode === AccessMode.PUBLIC) return AccessMode.PUBLIC
  return AccessMode.ORGANIZATION
}

function normalizeEnvironmentSubjects(subjects: EnvironmentWebAppSubject[]) {
  const groups: AccessControlGroup[] = []
  const members: AccessControlAccount[] = []

  subjects.forEach((subject) => {
    if (subject.subject_type === 'group') {
      const id = subject.subject_id || subject.group_data?.id
      const name = subject.group_data?.name
      const groupSize = subject.group_data?.group_size
      if (id && name && groupSize !== undefined) groups.push({ id, name, groupSize })
      return
    }

    if (subject.subject_type === 'account') {
      const id = subject.subject_id || subject.account_data?.id
      const name = subject.account_data?.name
      const email = subject.account_data?.email
      const avatar = subject.account_data?.avatar ?? ''
      if (id && name && email) members.push({ id, name, email, avatar, avatarUrl: avatar })
    }
  })

  return {
    groups,
    members,
  }
}
