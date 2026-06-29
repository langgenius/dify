'use client'

import type {
  EnvironmentDeployment,
  Release,
  RuntimeInstanceStatus as RuntimeInstanceStatusValue,
} from '@dify/contracts/enterprise/types.gen'
import type { TileConfig } from './environment-tile-utils'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import { openDeployDrawerAtom } from '../../../deploy-drawer/state'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { TitleTooltip } from '../../../shared/components/title-tooltip'
import { releaseCommit } from '../../../shared/domain/release'
import { DeploymentStatusBadge } from '../../../shared/ui/deployment-status-badge'
import {
  deploymentStatusLabelKey,
} from '../../../shared/ui/deployment-status-style'
import {
  renderActionLabel,
  renderDriftTitle,
  renderStatus,
  resolveConfig,
} from './environment-tile-utils'
import { computeDrift, latestReleaseId } from './overview-drift'

const OVERVIEW_CARD_CLASS_NAME = 'rounded-xl border border-components-panel-border bg-components-panel-bg p-4'
const OVERVIEW_INTERACTIVE_CARD_CLASS_NAME = cn(
  OVERVIEW_CARD_CLASS_NAME,
  'transition-colors hover:border-components-panel-border-subtle hover:bg-components-panel-on-panel-item-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-button-primary-bg',
)
const OVERVIEW_ICON_CLASS_NAME = 'flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-section-burn text-text-tertiary'

type EnvironmentTileProps = {
  row: EnvironmentDeployment
  releaseRows: Release[]
}

export function EnvironmentTile({ row, releaseRows }: EnvironmentTileProps) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)

  const envId = row.environment.id
  const drift = computeDrift(row)
  const status = row.status
  const latestId = latestReleaseId(releaseRows)
  const hasAnyRelease = releaseRows.length > 0
  const currentReleaseId = row.currentRelease?.id
  const config = resolveConfig({ drift, status, hasAnyRelease, latestId, currentReleaseId })
  const isDisabled = config.intent === 'disabled'
  const showStatusSignal = config.kind !== 'deploying'
  const release = row.currentRelease
  const showRelease = config.showRelease && release
  const commit = releaseCommit(release)
  const tooltip = isDisabled
    ? t('overview.chip.needsReleaseFirst')
    : config.intent === 'navigate'
      ? t('overview.chip.openInDeployTab')
      : undefined

  function handleDrawerAction() {
    if (config.intent === 'disabled' || !appInstanceId)
      return
    openDeployDrawer({ appInstanceId, environmentId: envId, releaseId: config.releaseId })
  }

  const actionClassName = cn(
    'inline-flex h-8 max-w-full min-w-0 shrink-0 items-center justify-center rounded-md px-2.5 system-xs-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-button-primary-bg',
    config.actionClass,
    isDisabled && 'cursor-not-allowed opacity-60',
  )
  const actionLabel = renderActionLabel(config.kind, Boolean(currentReleaseId), t)
  const actionControl = config.intent === 'navigate' && appInstanceId
    ? (
        <Link
          href={`/deployments/${appInstanceId}/instances`}
          className={actionClassName}
        >
          <span className="whitespace-nowrap">{actionLabel}</span>
        </Link>
      )
    : (
        <button
          type="button"
          disabled={isDisabled || !appInstanceId}
          onClick={handleDrawerAction}
          className={actionClassName}
        >
          <span className="whitespace-nowrap">{actionLabel}</span>
        </button>
      )

  return (
    <article
      data-slot="deployment-overview-environment-tile"
      className={cn(OVERVIEW_INTERACTIVE_CARD_CLASS_NAME, 'flex min-h-28 min-w-0 flex-col justify-between gap-4')}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span aria-hidden className={OVERVIEW_ICON_CLASS_NAME}>
            <span className="i-ri-server-line size-4" />
          </span>
          <h4 className="truncate system-sm-medium text-text-primary">
            {row.environment.displayName}
          </h4>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RuntimeStatusSignal status={status} t={t} />
          {showStatusSignal && <StatusSignal config={config} drift={drift} t={t} />}
        </div>
      </div>

      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="system-2xs-medium-uppercase text-text-tertiary">
            {t('deployTab.col.currentRelease')}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate system-sm-semibold text-text-primary">
              {showRelease ? showRelease.displayName : '—'}
            </span>
            {showRelease && commit !== '—' && (
              <span className="shrink-0 rounded bg-background-section-burn px-1.5 py-0.5 font-mono system-xs-regular text-text-tertiary">
                {commit}
              </span>
            )}
          </div>
        </div>

        {tooltip
          ? (
              <TitleTooltip content={tooltip}>
                <span className="inline-flex max-w-full min-w-0 shrink-0">
                  {actionControl}
                </span>
              </TitleTooltip>
            )
          : actionControl}
      </div>
    </article>
  )
}

function RuntimeStatusSignal({ status, t }: {
  status: RuntimeInstanceStatusValue
  t: ReturnType<typeof useTranslation<'deployments'>>['t']
}) {
  const label = t(deploymentStatusLabelKey(status))

  return (
    <TitleTooltip content={label}>
      <DeploymentStatusBadge status={status} label={label} />
    </TitleTooltip>
  )
}

function StatusSignal({ className, config, drift, t }: {
  className?: string
  config: TileConfig
  drift: ReturnType<typeof computeDrift>
  t: ReturnType<typeof useTranslation<'deployments'>>['t']
}) {
  const title = renderDriftTitle(config.kind, drift, t)

  return (
    <TitleTooltip content={title}>
      <DeploymentStatusBadge
        status={config.status}
        label={renderStatus(config.kind, drift, t)}
        className={className}
      />
    </TitleTooltip>
  )
}
