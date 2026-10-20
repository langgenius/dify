import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { AccessPoint } from '../utils/access-point'
import type { DeploymentVersion } from '../utils/version'
import type { UndeployDialogPayload } from './types'
import { RuntimeState } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { memo } from 'react'
import { AccessPointIcon } from '../shared/access-point-icon'
import { RuntimeStateIndicator } from '../shared/runtime-state'
import { VersionLabel } from '../shared/version-label'
import { ACCESS_POINT_ORDER, getAccessPointHref } from '../utils/access-point'
import { ActivityCell } from './activity-cell'
import { EnvironmentRowActions } from './row-actions'

export const EnvironmentRow = memo(
  ({
    appId,
    canViewAccessPoint,
    latestVersion,
    row,
    undeployDialogHandle,
  }: {
    appId: string
    canViewAccessPoint: boolean
    latestVersion?: DeploymentVersion
    row: EnvironmentDeployment
    undeployDialogHandle: AlertDialogHandle<UndeployDialogPayload>
  }) => {
    const runtimeState = row.deployment
      ? row.deployment.runtimeState
      : RuntimeState.RUNTIME_STATE_UNDEPLOYED

    const isAccessPointActive = (accessPoint: AccessPoint) => {
      if (accessPoint === 'webApp') return row.access.enable_site
      if (accessPoint === 'serviceApi') return row.access.enable_api
      return false
    }

    return (
      <tr className="h-14 border-b border-divider-subtle hover:bg-state-base-hover">
        <th scope="row" className="border-b border-divider-subtle pr-2 pl-3 text-left font-normal">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg text-text-secondary">
              <span aria-hidden className="i-ri-instance-line size-3.5" />
            </span>
            <span className="min-w-0 system-md-medium wrap-anywhere text-text-secondary">
              {row.environment.display_name}
            </span>
          </div>
        </th>
        <td className="border-b border-divider-subtle pr-2 pl-3">
          <VersionLabel
            version={row.deployment?.current_version}
            versionsBehind={row.deployment?.versions_behind}
          />
        </td>
        <td className="border-b border-divider-subtle px-2">
          <span role="status" aria-atomic="true">
            <span className="sr-only">{row.environment.display_name}: </span>
            <RuntimeStateIndicator runtimeState={runtimeState} />
          </span>
        </td>
        <td className="border-b border-divider-subtle pr-2 pl-3">
          <ActivityCell
            activity={row.deployment?.latest_operation}
            environmentName={row.environment.display_name}
          />
        </td>
        <td className="border-b border-divider-subtle pr-2 pl-3">
          <div className="flex items-center gap-1">
            {ACCESS_POINT_ORDER.map((accessPoint) => (
              <AccessPointIcon
                key={accessPoint}
                accessPoint={accessPoint}
                active={isAccessPointActive(accessPoint)}
                href={
                  canViewAccessPoint
                    ? getAccessPointHref(appId, row.environment.id, accessPoint)
                    : undefined
                }
              />
            ))}
          </div>
        </td>
        <td className="border-b border-divider-subtle pr-2 pl-3">
          <EnvironmentRowActions
            latestVersion={latestVersion}
            row={row}
            undeployDialogHandle={undeployDialogHandle}
          />
        </td>
      </tr>
    )
  },
)
EnvironmentRow.displayName = 'EnvironmentRow'
