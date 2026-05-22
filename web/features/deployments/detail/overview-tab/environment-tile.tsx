'use client'

import type { EnvironmentDeployment, ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { environmentId, environmentName } from '../../environment'
import { releaseCommit, releaseLabel } from '../../release'
import { deploymentStatus } from '../../runtime-status'
import { openDeployDrawerAtom } from '../../store'
import { computeDrift, latestReleaseId } from './overview-drift'

type EnvironmentTileProps = {
  appInstanceId: string
  row: EnvironmentDeployment
  releaseRows: ReleaseRow[]
}

type TileKind = 'empty' | 'latest' | 'behind' | 'older' | 'deploying' | 'failed'

type TileConfig = {
  kind: TileKind
  accentClass: string
  dotClass: string
  badgeClass: string
  iconClass: string
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
      router.push(`/deployments/${appInstanceId}/deploy`)
      return
    }
    openDeployDrawer({ appInstanceId, environmentId: envId, releaseId: config.releaseId })
  }

  return (
    <article
      data-slot="deployment-overview-environment-tile"
      className="group relative flex min-h-30 min-w-0 flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg p-3.5 shadow-xs transition-colors hover:border-components-panel-border-subtle hover:bg-components-panel-on-panel-item-bg-hover"
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', config.accentClass)} />

      <div className="flex min-w-0 items-start justify-between gap-3 pl-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span aria-hidden className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', config.iconClass)}>
            <span className="i-ri-server-line size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="truncate system-sm-semibold text-text-primary">
              {environmentName(row.environment)}
            </h4>
          </div>
        </div>
        <span className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs', config.badgeClass)}>
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', config.dotClass)} />
          <span>{renderStatus(config.kind, drift, t)}</span>
        </span>
      </div>

      <div className="mt-5 flex min-w-0 items-end justify-between gap-3 pl-1.5">
        <div className="min-w-0">
          <div className="system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
            {t('deployTab.col.currentRelease')}
          </div>
          <div className="mt-1 flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate title-md-semi-bold text-text-primary">
              {showRelease ? releaseLabel(release) : '—'}
            </span>
            {showRelease && commit !== '—' && (
              <span className="shrink-0 rounded-md bg-background-section-burn px-1.5 py-0.5 font-mono system-xs-regular text-text-tertiary">
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
            'inline-flex h-7 max-w-full min-w-0 items-center justify-center gap-1 rounded-md px-1.5 system-xs-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-button-primary-bg',
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
      accentClass: 'bg-util-colors-blue-blue-500',
      dotClass: 'bg-util-colors-blue-blue-500 animate-pulse',
      badgeClass: 'bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700',
      iconClass: 'bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700',
      actionClass: 'text-text-secondary hover:bg-state-base-hover',
      showRelease: true,
      intent: 'navigate',
    }
  }

  if (status === 'deploy_failed') {
    return {
      kind: 'failed',
      accentClass: 'bg-util-colors-red-red-500',
      dotClass: 'bg-util-colors-red-red-500',
      badgeClass: 'bg-util-colors-red-red-50 text-util-colors-red-red-700',
      iconClass: 'bg-util-colors-red-red-50 text-util-colors-red-red-700',
      actionClass: 'text-primary-600 hover:bg-state-accent-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId ?? latestId,
    }
  }

  if (drift.kind === 'undeployed') {
    return {
      kind: 'empty',
      accentClass: 'bg-text-quaternary',
      dotClass: 'bg-text-quaternary',
      badgeClass: 'bg-background-section-burn text-text-tertiary',
      iconClass: 'bg-background-section-burn text-text-tertiary',
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
      accentClass: 'bg-util-colors-green-green-500',
      dotClass: 'bg-util-colors-green-green-500',
      badgeClass: 'bg-util-colors-green-green-50 text-util-colors-green-green-700',
      iconClass: 'bg-util-colors-green-green-50 text-util-colors-green-green-700',
      actionClass: 'text-text-secondary hover:bg-state-base-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId,
    }
  }

  if (drift.kind === 'behind') {
    return {
      kind: 'behind',
      accentClass: 'bg-util-colors-warning-warning-500',
      dotClass: 'bg-util-colors-warning-warning-500',
      badgeClass: 'bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
      iconClass: 'bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
      actionClass: 'text-primary-600 hover:bg-state-accent-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: latestId,
    }
  }

  return {
    kind: 'older',
    accentClass: 'bg-text-tertiary',
    dotClass: 'bg-text-tertiary',
    badgeClass: 'bg-background-section-burn text-text-tertiary',
    iconClass: 'bg-background-section-burn text-text-tertiary',
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
