import type { EnvironmentDeploymentOperation } from '@dify/contracts/enterprise-app-deploy/types.gen'
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
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
  defaultVersionName: string,
) {
  if (activity.type === DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY)
    return t(($) => $['deployTab.undeploy'])

  const target = getWorkflowVersionName(activity.target_version, defaultVersionName)
  if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED)
    return t(($) => $['studio.activity.deployFailed'], { target })
  if (activity.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED)
    return t(($) => $['studio.activity.deploySucceeded'], { target })
  return t(($) => $['studio.activity.deploy'], { target })
}

export function ActivityCell({ activity }: { activity?: EnvironmentDeploymentOperation }) {
  const { t } = useTranslation('deployments')
  const { t: tWorkflow } = useTranslation('workflow')
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
        <span className="truncate">
          {activityLabel(
            activity,
            t,
            tWorkflow(($) => $['versionHistory.defaultName']),
          )}
        </span>
      </div>
      <div className="truncate system-xs-regular text-text-tertiary">
        {t(($) => $['studio.activity.meta'], {
          name: activity.operator.display_name,
          time: formatTimeFromNow(activity.activity_at * 1000),
        })}
      </div>
    </div>
  )
}
