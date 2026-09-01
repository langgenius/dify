import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AccessPoint } from '../access-point'
import type { UndeployHandler } from './types'
import { ACCESS_POINT_ORDER, getAccessPointHref } from '../access-point'
import { AccessPointIcon } from '../shared/access-point-icon'
import { DeploymentStatus } from '../shared/deployment-status'
import { VersionLabel } from '../shared/version-label'
import { ActivityCell } from './activity-cell'
import { EnvironmentRowActions } from './row-actions'

export function EnvironmentRow({
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
        <EnvironmentRowActions
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
