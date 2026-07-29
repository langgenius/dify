'use client'

import type { MockActivity, MockEnvironmentDeployment, MockRowAction } from './mock-data'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { AccessPointIcon } from './access-point-icon'
import { DeploymentStatus } from './deployment-status'
import { EnvironmentDeployMenu } from './environment-deploy-menu'
import { EnvironmentTableEmpty } from './environment-table-empty'
import {
  ACCESS_POINT_ORDER,
  MOCK_ENVIRONMENT_CAPACITY,
  MOCK_ENVIRONMENT_DEPLOYMENTS,
} from './mock-data'
import { UndeployConfirmDialog } from './undeploy-confirm-dialog'
import { VersionLabel } from './version-label'

function activityLabel(
  activity: MockActivity,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
) {
  if (activity.result === 'failed')
    return t(($) => $['studio.activity.deployFailed'], { target: activity.target })
  if (activity.result === 'succeeded')
    return t(($) => $['studio.activity.deploySucceeded'], { target: activity.target })
  return t(($) => $['studio.activity.deploy'], { target: activity.target })
}

function ActivityCell({ activity }: { activity: MockActivity }) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const failed = activity.result === 'failed'

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
          name: activity.actor,
          time: formatTimeFromNow(activity.occurredAt),
        })}
      </div>
    </div>
  )
}

function rowActionLabel(
  action: MockRowAction,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
) {
  switch (action.kind) {
    case 'changeVersion':
      return t(($) => $['studio.changeVersion'])
    case 'deployLatest':
      return t(($) => $['studio.deployLatest'])
    case 'redeploy':
      return t(($) => $['deployTab.redeploy'])
    case 'retry':
      return t(($) => $['studio.retryVersion'], { version: action.version })
  }
}

const ROW_ACTION_ICON_CLASS_NAMES: Record<MockRowAction['kind'], string> = {
  changeVersion: 'i-ri-repeat-line',
  deployLatest: 'i-custom-vender-deploy-rocket',
  redeploy: 'i-ri-reset-left-line',
  retry: 'i-ri-reset-left-line',
}

function RowActions({
  row,
  onChangeVersion,
  onUndeploy,
}: {
  row: MockEnvironmentDeployment
  onChangeVersion?: (deployment: MockEnvironmentDeployment) => void
  onUndeploy?: (deployment: MockEnvironmentDeployment) => void
}) {
  const { t } = useTranslation('deployments')
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const label = rowActionLabel(row.action, t)

  const handleUndeploy = useCallback(() => {
    onUndeploy?.(row)
    setShowUndeployConfirm(false)
  }, [onUndeploy, row])

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Button
          size="small"
          variant="secondary"
          disabled={row.action.kind === 'changeVersion' && row.action.disabled}
          onClick={() => row.action.kind === 'changeVersion' && onChangeVersion?.(row)}
          className="min-w-0 grow gap-1 px-2"
        >
          <span
            aria-hidden
            className={cn(ROW_ACTION_ICON_CLASS_NAMES[row.action.kind], 'size-3.5 shrink-0')}
          />
          <span className="truncate">{label}</span>
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                size="small"
                variant="secondary"
                aria-label={`${row.name} · ${t(($) => $['deployTab.moreActions'])}`}
                className="w-6 shrink-0 px-0"
              >
                <span aria-hidden className="i-ri-more-fill size-4" />
              </Button>
            }
          />
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-50">
            <DropdownMenuItem
              disabled={row.action.kind === 'changeVersion' && row.action.disabled}
              className="gap-2 px-2"
              onClick={() => onChangeVersion?.(row)}
            >
              <span aria-hidden className="i-ri-repeat-line size-4 shrink-0 text-text-secondary" />
              <span className="min-w-0 flex-1 truncate system-md-regular text-text-secondary">
                {t(($) => $['studio.changeVersion'])}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 px-2">
              <span
                aria-hidden
                className="i-custom-vender-other-replay-line size-4 shrink-0 text-text-secondary"
              />
              <span className="min-w-0 flex-1 truncate system-md-regular text-text-secondary">
                {t(($) => $['deployTab.redeploy'])}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 px-2" onClick={() => setShowUndeployConfirm(true)}>
              <span
                aria-hidden
                className="i-ri-logout-circle-r-line size-4 shrink-0 text-text-secondary"
              />
              <span className="min-w-0 flex-1 truncate system-md-regular text-text-secondary">
                {t(($) => $['deployTab.undeploy'])}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <UndeployConfirmDialog
        environmentName={row.name}
        open={showUndeployConfirm}
        onConfirm={handleUndeploy}
        onOpenChange={setShowUndeployConfirm}
      />
    </>
  )
}

function EnvironmentRow({
  row,
  onChangeVersion,
  onUndeploy,
}: {
  row: MockEnvironmentDeployment
  onChangeVersion?: (deployment: MockEnvironmentDeployment) => void
  onUndeploy?: (deployment: MockEnvironmentDeployment) => void
}) {
  return (
    <tr className="h-14 border-b border-divider-subtle hover:bg-state-base-hover">
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg text-text-secondary">
            <span aria-hidden className="i-ri-instance-line size-3.5" />
          </span>
          <span className="truncate system-md-medium text-text-secondary">{row.name}</span>
        </div>
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <VersionLabel version={row.version} />
      </td>
      <td className="border-b border-divider-subtle px-2">
        <DeploymentStatus status={row.status} />
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <ActivityCell activity={row.activity} />
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <div className="flex items-center gap-1">
          {ACCESS_POINT_ORDER.map((accessPoint) => (
            <AccessPointIcon
              key={accessPoint}
              accessPoint={accessPoint}
              active={row.accessPoints.includes(accessPoint)}
            />
          ))}
        </div>
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <RowActions row={row} onChangeVersion={onChangeVersion} onUndeploy={onUndeploy} />
      </td>
    </tr>
  )
}

type EnvironmentTableProps = {
  deployments?: MockEnvironmentDeployment[]
  onChangeVersion?: (deployment: MockEnvironmentDeployment) => void
  onDeployToEnvironment?: (environment: string) => void
  onUndeploy?: (deployment: MockEnvironmentDeployment) => void
}

export function EnvironmentTable({
  deployments = MOCK_ENVIRONMENT_DEPLOYMENTS,
  onChangeVersion,
  onDeployToEnvironment,
  onUndeploy,
}: EnvironmentTableProps) {
  const { t } = useTranslation('deployments')
  const used = deployments.length

  return (
    <section
      aria-labelledby="deploy-environments-title"
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
              total: MOCK_ENVIRONMENT_CAPACITY,
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
        {deployments.length === 0 ? (
          <EnvironmentTableEmpty onSelectEnvironment={onDeployToEnvironment} />
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
              <tr className="sticky top-0 z-10 h-7 rounded-lg bg-background-section-burn">
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
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
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['deployTab.col.actions'])}
                </th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((row) => (
                <EnvironmentRow
                  key={row.id}
                  row={row}
                  onChangeVersion={onChangeVersion}
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
