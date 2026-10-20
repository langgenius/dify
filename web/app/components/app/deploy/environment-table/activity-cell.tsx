import type { EnvironmentDeploymentOperation } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { TFunction } from 'i18next'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

function activityLabel(
  activity: EnvironmentDeploymentOperation,
  t: TFunction<['deployments', 'workflow', 'workflowHistory']>,
  defaultVersionName: string,
) {
  if (activity.type === DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY) {
    const action = t(($) => $['deployTab.undeploy'])
    if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED)
      return `${action} · ${t(($) => $['tracing.status.failed'], { ns: 'workflow' })}`
    if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED)
      return `${action} · ${t(($) => $['tracing.status.succeeded'], { ns: 'workflow' })}`
    if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS)
      return t(($) => $['status.RUNTIME_INSTANCE_STATUS_UNDEPLOYING'])
    return action
  }

  const target = getWorkflowVersionName(activity.target_version, defaultVersionName)
  if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED)
    return t(($) => $['studio.activity.deployFailed'], { target })
  if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED)
    return t(($) => $['studio.activity.deploySucceeded'], { target })
  return t(($) => $['studio.activity.deploy'], { target })
}

export function ActivityCell({
  activity,
  environmentName,
}: {
  activity?: EnvironmentDeploymentOperation
  environmentName: string
}) {
  const { t } = useTranslation(['deployments', 'workflow', 'workflowHistory'])
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const failed = activity?.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED
  const inProgress =
    activity?.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div role="status" aria-atomic="true">
        {activity ? (
          <div
            key={activity.id}
            className={cn(
              'flex min-w-0 items-center gap-1 system-xs-medium',
              failed ? 'text-util-colors-orange-orange-700' : 'text-text-secondary',
            )}
          >
            <span className="sr-only">{environmentName}: </span>
            {inProgress && (
              <span
                aria-hidden
                className="i-ri-loader-2-line size-3 shrink-0 animate-spin motion-reduce:animate-none"
              />
            )}
            {failed && (
              <span
                aria-hidden
                className="i-ri-error-warning-fill size-3 shrink-0 text-text-warning"
              />
            )}
            <span className="min-w-0 wrap-anywhere">
              {activityLabel(
                activity,
                t,
                t(($) => $['versionHistory.defaultName'], { ns: 'workflowHistory' }),
              )}
            </span>
          </div>
        ) : (
          <span className="text-text-quaternary">--</span>
        )}
      </div>
      {activity && (
        <div className="system-xs-regular wrap-anywhere text-text-tertiary">
          {t(($) => $['studio.activity.meta'], {
            name: activity.operator.display_name,
            time: formatTimeFromNow(activity.activity_at * 1000),
          })}
        </div>
      )}
    </div>
  )
}
