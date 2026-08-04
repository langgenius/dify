'use client'

import type {
  AppEnvironment,
  EnvironmentDeployment,
  EnvironmentDeploymentOperation,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AccessPoint } from './access-point'
import type { EnvironmentDeploymentAction } from './state'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useAtomValue } from 'jotai'
import { Fragment, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { ACCESS_POINT_ORDER, getAccessPointHref } from './access-point'
import { AccessPointIcon } from './access-point-icon'
import { DeploymentStatus } from './deployment-status'
import { EnvironmentDeployMenu } from './environment-deploy-menu'
import { EnvironmentTableEmpty } from './environment-table-empty'
import {
  appEnvironmentDeploymentsAtom,
  appEnvironmentDeploymentsIsErrorAtom,
  appEnvironmentDeploymentsIsFetchingAtom,
  appEnvironmentDeploymentsIsLoadingAtom,
  appEnvironmentDeploymentsRefetchAtom,
  appEnvironmentUsageAtom,
  getEnvironmentDeploymentActions,
  getWorkflowVersionName,
} from './state'
import { UndeployConfirmDialog } from './undeploy-confirm-dialog'
import { VersionLabel } from './version-label'

function activityLabel(
  activity: EnvironmentDeploymentOperation,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
) {
  if (activity.type === DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY)
    return t(($) => $['deployTab.undeploy'])

  const target = getWorkflowVersionName(activity.target_version) ?? `#${activity.id}`
  if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED)
    return t(($) => $['studio.activity.deployFailed'], { target })
  if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED)
    return t(($) => $['studio.activity.deploySucceeded'], { target })
  return t(($) => $['studio.activity.deploy'], { target })
}

function ActivityCell({ activity }: { activity?: EnvironmentDeploymentOperation }) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  if (!activity) return <span className="text-text-quaternary">--</span>

  const failed = activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div
        className={cn(
          'flex min-w-0 items-center gap-1 truncate system-xs-medium',
          failed ? 'text-text-warning' : 'text-text-secondary',
        )}
      >
        {failed && (
          <span aria-hidden className="i-ri-error-warning-fill size-3 shrink-0 text-text-warning" />
        )}
        <span className="truncate">{activityLabel(activity, t)}</span>
      </div>
      <div className="truncate system-xs-regular text-text-tertiary">
        {t(($) => $['studio.activity.meta'], {
          name: activity.operator.display_name,
          time: formatTimeFromNow(Date.parse(activity.activity_at)),
        })}
      </div>
    </div>
  )
}

function rowActionLabel(
  action: EnvironmentDeploymentAction,
  row: EnvironmentDeployment,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
) {
  switch (action.kind) {
    case 'changeVersion':
      return t(($) => $['studio.changeVersion'])
    case 'deployLatest':
      return t(($) => $['studio.deployLatest'])
    case 'redeploy':
      return t(($) => $['deployTab.redeploy'])
    case 'retry': {
      const operation = row.deployment?.latest_operation
      const version =
        getWorkflowVersionName(operation?.target_version) ??
        getWorkflowVersionName(row.deployment?.current_version) ??
        `#${operation?.id ?? row.environment.id}`
      return t(($) => $['studio.retryVersion'], { version })
    }
    case 'undeploy':
      return t(($) => $['deployTab.undeploy'])
  }
}

const ROW_ACTION_ICON_CLASS_NAMES: Record<EnvironmentDeploymentAction['kind'], string> = {
  changeVersion: 'i-ri-repeat-line',
  deployLatest: 'i-custom-vender-deploy-rocket',
  redeploy: 'i-ri-reset-left-line',
  retry: 'i-ri-reset-left-line',
  undeploy: 'i-ri-logout-circle-r-line',
}

type UndeployHandler = (deployment: EnvironmentDeployment) => Promise<void> | void

function RowActions({
  row,
  onChangeVersion,
  onDeployLatest,
  onRedeploy,
  onUndeploy,
}: {
  row: EnvironmentDeployment
  onChangeVersion?: (deployment: EnvironmentDeployment) => void
  onDeployLatest?: (deployment: EnvironmentDeployment) => void
  onRedeploy?: (deployment: EnvironmentDeployment) => void
  onUndeploy?: UndeployHandler
}) {
  const { t } = useTranslation('deployments')
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const [isUndeploying, setIsUndeploying] = useState(false)
  const actions = getEnvironmentDeploymentActions(row)
  const primaryAction = actions[0]
  const moreActions = actions.slice(1)

  const handleAction = useCallback(
    (action: EnvironmentDeploymentAction) => {
      if (action.disabled) return

      switch (action.kind) {
        case 'changeVersion':
          onChangeVersion?.(row)
          break
        case 'deployLatest':
          onDeployLatest?.(row)
          break
        case 'redeploy':
        case 'retry':
          onRedeploy?.(row)
          break
        case 'undeploy':
          setShowUndeployConfirm(true)
          break
      }
    },
    [onChangeVersion, onDeployLatest, onRedeploy, row],
  )

  const handleUndeploy = useCallback(async () => {
    if (isUndeploying) return

    setIsUndeploying(true)
    try {
      await onUndeploy?.(row)
      setShowUndeployConfirm(false)
    } catch {
      // The request layer reports the error; keep the dialog open so the user can retry.
    } finally {
      setIsUndeploying(false)
    }
  }, [isUndeploying, onUndeploy, row])

  if (!primaryAction) return null

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Button
          size="small"
          variant="secondary"
          disabled={primaryAction.disabled}
          onClick={() => handleAction(primaryAction)}
          className="min-w-0 gap-1 px-2"
        >
          <span
            aria-hidden
            className={cn(ROW_ACTION_ICON_CLASS_NAMES[primaryAction.kind], 'size-3.5 shrink-0')}
          />
          <span className="truncate">{rowActionLabel(primaryAction, row, t)}</span>
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                size="small"
                variant="secondary"
                aria-label={`${row.environment.display_name} · ${t(($) => $['deployTab.moreActions'])}`}
                className="w-6 shrink-0 px-0"
              >
                <span aria-hidden className="i-ri-more-fill size-4" />
              </Button>
            }
          />
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-50">
            {moreActions.map((action, index) => (
              <Fragment key={action.kind}>
                {action.kind === 'undeploy' && index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  disabled={action.disabled}
                  className="gap-2 px-2"
                  onClick={() => handleAction(action)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      ROW_ACTION_ICON_CLASS_NAMES[action.kind],
                      'size-4 shrink-0 text-text-secondary',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate system-md-regular text-text-secondary">
                    {rowActionLabel(action, row, t)}
                  </span>
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <UndeployConfirmDialog
        environmentName={row.environment.display_name}
        isPending={isUndeploying}
        open={showUndeployConfirm}
        onConfirm={handleUndeploy}
        onOpenChange={setShowUndeployConfirm}
      />
    </>
  )
}

function EnvironmentRow({
  appId,
  row,
  onChangeVersion,
  onDeployLatest,
  onRedeploy,
  onUndeploy,
}: {
  appId: string
  row: EnvironmentDeployment
  onChangeVersion?: (deployment: EnvironmentDeployment) => void
  onDeployLatest?: (deployment: EnvironmentDeployment) => void
  onRedeploy?: (deployment: EnvironmentDeployment) => void
  onUndeploy?: UndeployHandler
}) {
  const isAccessPointActive = (accessPoint: AccessPoint) => {
    if (accessPoint === 'webApp') return row.access.enable_site
    if (accessPoint === 'serviceApi') return row.access.enable_api
    return false
  }

  return (
    <tr className="h-14 border-b border-divider-subtle hover:bg-state-base-hover">
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg text-text-secondary">
            <span aria-hidden className="i-ri-instance-line size-3.5" />
          </span>
          <span className="truncate system-md-medium text-text-secondary">
            {row.environment.display_name}
          </span>
        </div>
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <VersionLabel
          version={row.deployment?.current_version}
          versionsBehind={row.deployment?.versions_behind}
        />
      </td>
      <td className="border-b border-divider-subtle px-2">
        <DeploymentStatus status={row.deployment?.status} />
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <ActivityCell activity={row.deployment?.latest_operation} />
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <div className="flex items-center gap-1">
          {ACCESS_POINT_ORDER.map((accessPoint) => (
            <AccessPointIcon
              key={accessPoint}
              accessPoint={accessPoint}
              active={isAccessPointActive(accessPoint)}
              href={getAccessPointHref(appId, row.environment.id, accessPoint)}
            />
          ))}
        </div>
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <RowActions
          row={row}
          onChangeVersion={onChangeVersion}
          onDeployLatest={onDeployLatest}
          onRedeploy={onRedeploy}
          onUndeploy={onUndeploy}
        />
      </td>
    </tr>
  )
}

type EnvironmentTableProps = {
  appId: string
  onChangeVersion?: (deployment: EnvironmentDeployment) => void
  onDeployLatest?: (deployment: EnvironmentDeployment) => void
  onDeployToEnvironment?: (environment: AppEnvironment) => void
  onRedeploy?: (deployment: EnvironmentDeployment) => void
  onUndeploy?: UndeployHandler
}

export function EnvironmentTable({
  appId,
  onChangeVersion,
  onDeployLatest,
  onDeployToEnvironment,
  onRedeploy,
  onUndeploy,
}: EnvironmentTableProps) {
  const { t } = useTranslation('deployments')
  const deployments = useAtomValue(appEnvironmentDeploymentsAtom) ?? []
  const isLoading = useAtomValue(appEnvironmentDeploymentsIsLoadingAtom)
  const isError = useAtomValue(appEnvironmentDeploymentsIsErrorAtom)
  const isFetching = useAtomValue(appEnvironmentDeploymentsIsFetchingAtom)
  const refetchDeployments = useAtomValue(appEnvironmentDeploymentsRefetchAtom)
  const usage = useAtomValue(appEnvironmentUsageAtom)
  const used = usage?.used ?? deployments.length
  const total = usage?.total ?? deployments.length
  const showLoadingState = isLoading && deployments.length === 0
  const showErrorState = isError && deployments.length === 0
  const isRetrying = showErrorState && isFetching
  const showEmptyState = !isLoading && !isError && deployments.length === 0

  return (
    <section
      aria-labelledby="deploy-environments-title"
      aria-busy={showLoadingState || isRetrying}
      className="flex min-h-0 grow flex-col gap-3"
    >
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id="deploy-environments-title"
            className="truncate system-md-semibold text-text-primary"
          >
            {t(($) => $['studio.environments'])}
          </h2>
          <span aria-hidden className="system-xs-regular text-text-quaternary">
            ·
          </span>
          <span className="truncate system-xs-regular text-text-tertiary">
            {t(($) => $['studio.environmentsInUse'], {
              total,
              used,
            })}
          </span>
        </div>
        <EnvironmentDeployMenu onSelectEnvironment={onDeployToEnvironment} />
      </div>

      <div
        className={cn(
          'min-h-0 w-full grow overflow-y-auto',
          deployments.length > 0 ? 'overflow-x-auto' : 'overflow-x-hidden',
        )}
      >
        {showLoadingState ? (
          <Loading className="h-full" />
        ) : showErrorState ? (
          <EnvironmentTableEmpty
            state="error"
            isRetrying={isRetrying}
            onRetry={() => void refetchDeployments()}
          />
        ) : showEmptyState ? (
          <EnvironmentTableEmpty state="empty" onSelectEnvironment={onDeployToEnvironment} />
        ) : (
          <table className="w-full min-w-260 table-fixed border-separate border-spacing-0">
            <colgroup>
              <col className="w-43" />
              <col className="w-46" />
              <col className="w-44" />
              <col />
              <col className="w-36" />
              <col className="w-44" />
            </colgroup>
            <thead>
              <tr className="sticky top-0 z-10 h-7 bg-background-section-burn">
                <th className="rounded-l-lg pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['deployTab.col.environment'])}
                </th>
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['studio.liveVersion'])}
                </th>
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['deployTab.col.status'])}
                </th>
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['studio.lastActivity'])}
                </th>
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['studio.accessPoints'])}
                </th>
                <th className="rounded-r-lg pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['deployTab.col.actions'])}
                </th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((row) => (
                <EnvironmentRow
                  key={row.environment.id}
                  appId={appId}
                  row={row}
                  onChangeVersion={onChangeVersion}
                  onDeployLatest={onDeployLatest}
                  onRedeploy={onRedeploy}
                  onUndeploy={onUndeploy}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
