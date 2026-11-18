import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { OpenDeploymentDialog } from '../types'
import type { AccessPoint } from '../utils/access-point'
import type { DeploymentVersion } from '../utils/version'
import type { OpenUndeployDialog } from './types'
import { RuntimeState } from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
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
    onOpenDeployment,
    onOpenUndeploy,
  }: {
    appId: string
    canViewAccessPoint: boolean
    latestVersion?: DeploymentVersion
    row: EnvironmentDeployment
    onOpenDeployment: OpenDeploymentDialog
    onOpenUndeploy: OpenUndeployDialog
  }) => {
    const { t } = useTranslation(['deployments'])
    const { formatTimeFromNow } = useFormatTimeFromNow()
    const suspendedAt = row.deployment?.suspended_at
    const suspendedBy = row.deployment?.suspended_by
    const suspensionDescription = suspendedAt
      ? t(
          ($) =>
            $[
              suspendedBy?.type === 'OPERATOR_TYPE_DASHBOARD_ACCOUNT'
                ? 'studio.pausedFromDashboard'
                : 'studio.pausedBy'
            ],
          {
            name: suspendedBy?.display_name ?? '--',
            time: formatTimeFromNow(suspendedAt * 1000),
          },
        )
      : undefined
    const runtimeState = row.deployment
      ? row.deployment.runtimeState
      : RuntimeState.RUNTIME_STATE_UNDEPLOYED

    const isAccessPointActive = (accessPoint: AccessPoint) => {
      if (accessPoint === 'webApp') return row.access.enable_site
      if (accessPoint === 'serviceApi') return row.access.enable_api
      if (accessPoint === 'mcp') return row.access.enable_mcp
      return row.access.enable_trigger
    }

    return (
      <tr className="h-14 border-b border-divider-subtle hover:bg-state-base-hover">
        <th scope="row" className="border-b border-divider-subtle ps-3 pe-2 text-start font-normal">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg text-text-secondary">
              <span aria-hidden className="i-ri-instance-line size-3.5" />
            </span>
            <span className="min-w-0 system-md-medium wrap-anywhere text-text-secondary">
              {row.environment.display_name}
            </span>
          </div>
        </th>
        <td className="border-b border-divider-subtle ps-3 pe-2">
          <VersionLabel
            version={row.deployment?.current_version}
            versionsBehind={row.deployment?.versions_behind}
          />
        </td>
        <td className="border-b border-divider-subtle px-2">
          <span role="status" aria-atomic="true">
            <span className="sr-only">{row.environment.display_name}: </span>
            {suspendedAt ? (
              <Popover>
                <PopoverTrigger
                  openOnHover
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-xs system-xs-semibold-uppercase text-util-colors-orange-orange-700 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    >
                      <StatusDot size="small" status="warning" />
                      <span className="underline decoration-dotted underline-offset-2">
                        {t(($) => $['studio.suspended'])}
                      </span>
                    </button>
                  }
                />
                <PopoverContent className="px-3 py-2 system-xs-regular text-text-secondary">
                  <PopoverDescription>{suspensionDescription}</PopoverDescription>
                </PopoverContent>
              </Popover>
            ) : (
              <RuntimeStateIndicator runtimeState={runtimeState} />
            )}
          </span>
        </td>
        <td className="border-b border-divider-subtle ps-3 pe-2">
          <ActivityCell
            activity={row.deployment?.latest_operation}
            environmentName={row.environment.display_name}
          />
        </td>
        <td className="border-b border-divider-subtle ps-3 pe-2">
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
        <td className="border-b border-divider-subtle ps-3 pe-2">
          <EnvironmentRowActions
            appId={appId}
            latestVersion={latestVersion}
            row={row}
            onOpenDeployment={onOpenDeployment}
            onOpenUndeploy={onOpenUndeploy}
          />
        </td>
      </tr>
    )
  },
)
EnvironmentRow.displayName = 'EnvironmentRow'
