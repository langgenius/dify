'use client'

import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useDocLink } from '@/context/i18n'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { useAppWorkflow } from '@/service/use-workflow'
import { useAccessPointActions } from '../shared/use-access-point-actions'
import { getPublishedWorkflowState, isAdvancedApp } from '../shared/utils'
import { MCPAccessPointCard } from './mcp-card'
import { ServiceApiAccessPointCard } from './service-api-card'
import { TriggerAccessPointCard } from './trigger-card'
import { WebAppAccessPointCard } from './web-app-card'

type BuiltInAccessPointsProps = {
  appId: string
  canViewLayout: boolean
  canDeploy: boolean
  canManageAccessPoint: boolean
  canReleaseAndVersion: boolean
  highlightedAccessPoint?: AccessPoint | null
}

export function BuiltInAccessPoints({
  appId,
  canViewLayout,
  canDeploy,
  canManageAccessPoint,
  canReleaseAndVersion,
  highlightedAccessPoint,
}: BuiltInAccessPointsProps) {
  const { t } = useTranslation(['common', 'deployments'])
  const docLink = useDocLink()
  const { data: appInfo } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const workspace = useAtomValue(currentWorkspaceAtom)
  const workspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  const canReadWorkflow =
    canViewLayout &&
    (systemFeatures.rbac_enabled ||
      (!workspaceLoading && ['owner', 'admin', 'editor'].includes(workspace.role)))
  const shouldFetchWorkflow = Boolean(appInfo && isAdvancedApp(appInfo) && canReadWorkflow)
  const {
    data: workflow,
    isError: workflowError,
    isPending: workflowLoading,
  } = useAppWorkflow(shouldFetchWorkflow ? appId : '', {
    retry: (failureCount, error) => {
      if (getHttpErrorStatus(error) === 403) return false

      return failureCount < 3
    },
  })
  const useWorkflowSummary = Boolean(appInfo && isAdvancedApp(appInfo) && !canReadWorkflow)
  const needsPublishedTriggers =
    useWorkflowSummary && appInfo?.mode === 'workflow' && Boolean(appInfo.workflow?.id)
  const triggersQuery = useQuery(
    consoleQuery.apps.byAppId.triggers.get.queryOptions({
      input: appInfo?.mode === 'workflow' ? { params: { app_id: appId } } : skipToken,
      enabled: needsPublishedTriggers,
      retry: false,
    }),
  )
  const actions = useAccessPointActions(appId, canManageAccessPoint)

  if (!appInfo) return <LoadingPlaceholder />

  const workflowState = getPublishedWorkflowState(appInfo, workflow)
  const isUnpublished = useWorkflowSummary ? !appInfo.workflow?.id : workflowState.isUnpublished
  const hasTriggerNode = useWorkflowSummary
    ? needsPublishedTriggers && Boolean(triggersQuery.data?.data.length)
    : workflowState.hasTriggerNode
  const builtInLoading =
    workflowState.requiresPublishedWorkflow &&
    (workspaceLoading ||
      (shouldFetchWorkflow && workflowLoading) ||
      (needsPublishedTriggers && triggersQuery.isPending))
  const builtInError =
    (shouldFetchWorkflow && workflowError) || (needsPublishedTriggers && triggersQuery.isError)
  const appCardsUnavailable =
    workflowState.requiresPublishedWorkflow && (builtInError || isUnpublished || hasTriggerNode)
  const appCardAvailability = builtInLoading
    ? 'loading'
    : appCardsUnavailable
      ? 'unavailable'
      : 'available'
  const triggerAvailability = builtInLoading
    ? 'loading'
    : builtInError || isUnpublished || !hasTriggerNode
      ? 'unavailable'
      : 'available'
  const mcpAvailability = builtInLoading
    ? 'loading'
    : appCardsUnavailable ||
        (!workflowState.requiresPublishedWorkflow && !appInfo.model_config?.updated_at) ||
        (canReadWorkflow && workflowState.isWorkflowApp && !workflowState.hasStartNode)
      ? 'unavailable'
      : 'available'

  return (
    <div className="flex h-full flex-col gap-2">
      {isUnpublished && !builtInLoading && !builtInError && (
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
          {canReleaseAndVersion ? (
            <Link
              href={`/app/${appId}/workflow`}
              className={cn(
                buttonVariants({ variant: 'primary', size: 'medium' }),
                'flex items-center gap-1',
              )}
            >
              {t(($) => $['studio.accessPoint.goToPublish'], { ns: 'deployments' })}
              <span aria-hidden className="i-ri-arrow-right-line size-4" />
            </Link>
          ) : (
            <Button variant="primary" size="medium" disabled className="flex items-center gap-1">
              {t(($) => $['studio.accessPoint.goToPublish'], { ns: 'deployments' })}
              <span aria-hidden className="i-ri-arrow-right-line size-4" />
            </Button>
          )}
        </div>
      )}

      <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
        <WebAppAccessPointCard
          appInfo={appInfo}
          availability={appCardAvailability}
          canDeploy={canDeploy}
          canManageAccessPoint={canManageAccessPoint}
          showAccessControl={systemFeatures.webapp_auth.enabled}
          onRefreshApp={actions.refreshAppDetail}
          onSaveSiteConfig={actions.saveSiteConfig}
          workflow={workflow}
          highlighted={highlightedAccessPoint === 'webApp'}
        />
        <ServiceApiAccessPointCard
          appInfo={appInfo}
          availability={appCardAvailability}
          canManage={canManageAccessPoint}
          highlighted={highlightedAccessPoint === 'serviceApi'}
        />
        <MCPAccessPointCard
          appInfo={appInfo}
          canManageAccessPoint={canManageAccessPoint}
          workflow={workflow}
          availability={mcpAvailability}
          highlighted={highlightedAccessPoint === 'mcp'}
        />
        {workflowState.isWorkflowApp && (
          <TriggerAccessPointCard
            appInfo={appInfo}
            availability={triggerAvailability}
            canManageAccessPoint={canManageAccessPoint}
            highlighted={highlightedAccessPoint === 'trigger'}
          />
        )}
      </div>

      {hasTriggerNode && (
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
