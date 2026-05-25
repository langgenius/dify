'use client'

import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { environmentId, environmentName } from '../../environment'
import { releaseCommit, releaseLabel } from '../../release'
import { deploymentStatus } from '../../runtime-status'
import { openDeployDrawerAtom } from '../../store'
import { OVERVIEW_ICON_CLASS_NAME, OVERVIEW_INTERACTIVE_CARD_CLASS_NAME, OVERVIEW_STATUS_BADGE_CLASS_NAME } from './card-styles'
import { computeDrift, latestReleaseId } from './overview-drift'

type EnvironmentTileProps = {
  appInstanceId: string
  row: EnvironmentDeployment
  releaseRows: Release[]
}

type TileKind = 'empty' | 'latest' | 'behind' | 'older' | 'deploying' | 'failed'

type TileConfig = {
  kind: TileKind
  dotClass: string
  statusClass: string
  actionClass: string
  showRelease: boolean
  intent: 'drawer' | 'navigate' | 'disabled'
  releaseId?: string
}

export function EnvironmentTile({ appInstanceId, row, releaseRows }: EnvironmentTileProps) {
  const { t } = useTranslation('deployments')
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const router = useRouter()

  const envId = environmentId(row.environment)
  const drift = computeDrift(row, releaseRows)
  const status = deploymentStatus(row)
  const latestId = latestReleaseId(releaseRows)
  const hasAnyRelease = releaseRows.length > 0
  const currentReleaseId = row.currentRelease?.id
  const config = resolveConfig({ drift, status, hasAnyRelease, latestId, currentReleaseId })
  const isDisabled = config.intent === 'disabled'
  const release = row.currentRelease
  const showRelease = config.showRelease && Boolean(release?.id)
  const commit = releaseCommit(release)
  const tooltip = isDisabled
    ? t('overview.chip.needsReleaseFirst')
    : config.intent === 'navigate'
      ? t('overview.chip.openInDeployTab')
      : undefined

  function handleAction() {
    if (config.intent === 'disabled')
      return
    if (config.intent === 'navigate') {
      router.push(`/deployments/${appInstanceId}/instances`)
      return
    }
    openDeployDrawer({ appInstanceId, environmentId: envId, releaseId: config.releaseId })
  }

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
            {environmentName(row.environment)}
          </h4>
        </div>
        <StatusSignal config={config} drift={drift} t={t} />
      </div>

      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="system-2xs-medium-uppercase text-text-tertiary">
            {t('deployTab.col.currentRelease')}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate system-sm-semibold text-text-primary">
              {showRelease ? releaseLabel(release) : '—'}
            </span>
            {showRelease && commit !== '—' && (
              <span className="shrink-0 rounded bg-background-section-burn px-1.5 py-0.5 font-mono system-xs-regular text-text-tertiary">
                {commit}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={isDisabled}
          title={tooltip}
          onClick={handleAction}
          className={cn(
            'inline-flex h-8 max-w-full min-w-0 shrink-0 items-center justify-center rounded-md px-2.5 system-xs-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-button-primary-bg',
            config.actionClass,
            isDisabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="whitespace-nowrap">{renderActionLabel(config.kind, Boolean(currentReleaseId), t)}</span>
        </button>
      </div>
    </article>
  )
}

function StatusSignal({ className, config, drift, t }: {
  className?: string
  config: TileConfig
  drift: ReturnType<typeof computeDrift>
  t: ReturnType<typeof useTranslation<'deployments'>>['t']
}) {
  return (
    <span className={cn(OVERVIEW_STATUS_BADGE_CLASS_NAME, config.statusClass, className)}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', config.dotClass)} />
      <span>{renderStatus(config.kind, drift, t)}</span>
    </span>
  )
}

function resolveConfig({ drift, status, hasAnyRelease, latestId, currentReleaseId }: {
  drift: ReturnType<typeof computeDrift>
  status: ReturnType<typeof deploymentStatus>
  hasAnyRelease: boolean
  latestId: string | undefined
  currentReleaseId: string | undefined
}): TileConfig {
  if (status === 'deploying') {
    return {
      kind: 'deploying',
      dotClass: 'bg-util-colors-blue-blue-500 animate-pulse',
      statusClass: 'text-util-colors-blue-blue-700',
      actionClass: 'text-text-secondary hover:bg-state-base-hover hover:text-text-primary',
      showRelease: true,
      intent: 'navigate',
    }
  }

  if (status === 'deploy_failed') {
    return {
      kind: 'failed',
      dotClass: 'bg-util-colors-red-red-500',
      statusClass: 'text-util-colors-red-red-700',
      actionClass: 'text-primary-600 hover:bg-state-accent-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId ?? latestId,
    }
  }

  if (drift.kind === 'undeployed') {
    return {
      kind: 'empty',
      dotClass: 'bg-text-quaternary',
      statusClass: 'text-text-tertiary',
      actionClass: hasAnyRelease
        ? 'text-primary-600 hover:bg-state-accent-hover'
        : 'text-text-tertiary',
      showRelease: false,
      intent: hasAnyRelease ? 'drawer' : 'disabled',
      releaseId: latestId,
    }
  }

  if (drift.kind === 'up-to-date') {
    return {
      kind: 'latest',
      dotClass: 'bg-util-colors-green-green-500',
      statusClass: 'text-util-colors-green-green-700',
      actionClass: 'text-text-secondary hover:bg-state-base-hover hover:text-text-primary',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId,
    }
  }

  if (drift.kind === 'behind') {
    return {
      kind: 'behind',
      dotClass: 'bg-util-colors-warning-warning-500',
      statusClass: 'text-util-colors-warning-warning-700',
      actionClass: 'text-primary-600 hover:bg-state-accent-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: latestId,
    }
  }

  return {
    kind: 'older',
    dotClass: 'bg-text-tertiary',
    statusClass: 'text-text-tertiary',
    actionClass: 'text-primary-600 hover:bg-state-accent-hover',
    showRelease: true,
    intent: 'drawer',
    releaseId: latestId,
  }
}

function renderActionLabel(
  kind: TileKind,
  hasCurrentRelease: boolean,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
): string {
  switch (kind) {
    case 'empty':
    case 'older':
    case 'behind':
      return t('overview.cardAction.deployLatest')
    case 'latest':
      return t('overview.cardAction.redeploy')
    case 'deploying':
      return t('overview.cardAction.viewProgress')
    case 'failed':
      return hasCurrentRelease
        ? t('overview.cardAction.redeploy')
        : t('overview.cardAction.deployLatest')
  }
}

function renderStatus(
  kind: TileKind,
  drift: ReturnType<typeof computeDrift>,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
): string {
  switch (kind) {
    case 'empty':
      return t('overview.chip.empty')
    case 'latest':
      return t('overview.chip.latest')
    case 'behind':
      return t('overview.chip.behind', { count: drift.kind === 'behind' ? drift.steps : 0 })
    case 'older':
      return t('overview.chip.olderRelease')
    case 'deploying':
      return t('overview.chip.deploying')
    case 'failed':
      return t('overview.chip.failed')
  }
}
