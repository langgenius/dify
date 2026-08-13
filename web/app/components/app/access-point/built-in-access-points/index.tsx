'use client'

import type { AccessPoint } from '@/app/components/app/deploy/access-point'
import { Button } from '@langgenius/dify-ui/button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { useDocLink } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { useAppWorkflow } from '@/service/use-workflow'
import { getAppACLCapabilities } from '@/utils/permission'
import { useAccessPointActions } from '../shared/use-access-point-actions'
import { getPublishedWorkflowState, isAdvancedApp } from '../shared/utils'
import { MCPAccessPointCard } from './mcp-card'
import { ServiceApiAccessPointCard } from './service-api-card'
import { TriggerAccessPointCard } from './trigger-card'
import { WebAppAccessPointCard } from './web-app-card'

type BuiltInAccessPointsProps = {
  appId: string
  highlightedAccessPoint?: AccessPoint | null
}

export function BuiltInAccessPoints({ appId, highlightedAccessPoint }: BuiltInAccessPointsProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const appInfo = useAppStore((state) => state.appDetail)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const shouldFetchWorkflow = Boolean(appInfo && isAdvancedApp(appInfo))
  const { data: workflow, isPending: workflowLoading } = useAppWorkflow(
    shouldFetchWorkflow ? appId : '',
  )
  const capabilities = useMemo(
    () =>
      getAppACLCapabilities(appInfo?.permission_keys, {
        currentUserId,
        resourceMaintainer: appInfo?.maintainer,
        workspacePermissionKeys,
      }),
    [appInfo?.maintainer, appInfo?.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const actions = useAccessPointActions(appId, capabilities.canEdit)

  if (!appInfo) return <Loading />

  const workflowState = getPublishedWorkflowState(appInfo, workflow)
  const builtInLoading = workflowState.isWorkflowApp && workflowLoading
  const appCardsUnavailable =
    workflowState.isWorkflowApp && (workflowState.isUnpublished || workflowState.hasTriggerNode)
  const appCardAvailability = builtInLoading
    ? 'loading'
    : appCardsUnavailable
      ? 'unavailable'
      : 'available'
  const triggerAvailability = builtInLoading
    ? 'loading'
    : workflowState.isUnpublished || !workflowState.hasTriggerNode
      ? 'unavailable'
      : 'available'

  return (
    <div className="flex h-full flex-col gap-2">
      {workflowState.isUnpublished && !workflowLoading && (
        <div className="flex flex-col items-start gap-2 rounded-xl bg-background-section-burn p-3">
          <div className="flex flex-col gap-0.5">
            <span className="block system-md-semibold text-text-secondary">
              {t(($) => $['studio.accessPoint.noPublishedTitle'], {
                ns: 'deployments',
              })}
            </span>
            <span className="block system-xs-regular text-text-tertiary">
              {t(($) => $['studio.accessPoint.noPublishedDescription'], {
                ns: 'deployments',
              })}
            </span>
          </div>
          <Button
            variant="primary"
            size="medium"
            disabled={!capabilities.canReleaseAndVersion}
            render={<Link href={`/app/${appId}/workflow`} />}
            className="flex items-center gap-1"
          >
            {t(($) => $['studio.accessPoint.goToPublish'], { ns: 'deployments' })}
            <span aria-hidden className="i-ri-arrow-right-line size-4" />
          </Button>
        </div>
      )}

      <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
        <WebAppAccessPointCard
          appInfo={appInfo}
          availability={appCardAvailability}
          canEdit={capabilities.canEdit}
          canDeploy={capabilities.canDeploy}
          canManageAccess={capabilities.canReleaseAndVersion}
          showAccessControl={systemFeatures.webapp_auth.enabled}
          onChangeStatus={actions.changeSiteStatus}
          onRefreshApp={actions.refreshAppDetail}
          onRegenerate={actions.regenerateSiteCode}
          onSaveSiteConfig={actions.saveSiteConfig}
          workflow={workflow}
          highlighted={highlightedAccessPoint === 'webApp'}
        />
        <ServiceApiAccessPointCard
          appInfo={appInfo}
          availability={appCardAvailability}
          canManage={capabilities.canReleaseAndVersion}
          onChangeStatus={actions.changeApiStatus}
          highlighted={highlightedAccessPoint === 'serviceApi'}
        />
        <MCPAccessPointCard
          appInfo={appInfo}
          canEdit={capabilities.canEdit}
          workflow={workflow}
          workflowLoading={workflowLoading}
          triggerModeDisabled={workflowState.hasTriggerNode}
          highlighted={highlightedAccessPoint === 'mcp'}
        />
        {workflowState.isWorkflowApp && (
          <TriggerAccessPointCard
            appInfo={appInfo}
            availability={triggerAvailability}
            canEdit={capabilities.canEdit}
            onToggleResult={actions.handleResult}
            highlighted={highlightedAccessPoint === 'trigger'}
          />
        )}
      </div>

      {workflowState.hasTriggerNode && (
        <div className="mt-2 flex min-h-10 items-center gap-2 rounded-xl bg-background-section-burn px-3 py-2 system-xs-regular text-text-tertiary">
          <span aria-hidden className="i-ri-information-line size-4 shrink-0" />
          <span>
            {t(($) => $['studio.accessPoint.triggerExclusiveNotice'], {
              ns: 'deployments',
            })}{' '}
            <Link
              href={docLink('/use-dify/nodes/start')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-accent hover:underline"
            >
              {t(($) => $['operation.learnMore'], { ns: 'common' })}
            </Link>
          </span>
        </div>
      )}
    </div>
  )
}
