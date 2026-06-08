import type { TFunction } from 'i18next'
import type { deploymentStatus, DeploymentUiStatus } from '../../runtime-status'
import type { computeDrift } from './overview-drift'

export type TileKind = 'empty' | 'latest' | 'behind' | 'older' | 'deploying' | 'failed'

export type TileConfig = {
  kind: TileKind
  status: DeploymentUiStatus
  actionClass: string
  showRelease: boolean
  intent: 'drawer' | 'navigate' | 'disabled'
  releaseId?: string
}

export function resolveConfig({ drift, status, hasAnyRelease, latestId, currentReleaseId }: {
  drift: ReturnType<typeof computeDrift>
  status: ReturnType<typeof deploymentStatus>
  hasAnyRelease: boolean
  latestId: string | undefined
  currentReleaseId: string | undefined
}): TileConfig {
  if (status === 'deploying') {
    return {
      kind: 'deploying',
      status: 'deploying',
      actionClass: 'text-text-secondary hover:bg-state-base-hover hover:text-text-primary',
      showRelease: true,
      intent: 'navigate',
    }
  }

  if (status === 'deploy_failed') {
    return {
      kind: 'failed',
      status: 'deploy_failed',
      actionClass: 'text-primary-600 hover:bg-state-accent-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId ?? latestId,
    }
  }

  if (drift.kind === 'undeployed') {
    return {
      kind: 'empty',
      status: 'not_deployed',
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
      status: 'ready',
      actionClass: 'text-text-secondary hover:bg-state-base-hover hover:text-text-primary',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId,
    }
  }

  if (drift.kind === 'behind') {
    return {
      kind: 'behind',
      status: 'drifted',
      actionClass: 'text-primary-600 hover:bg-state-accent-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: latestId,
    }
  }

  return {
    kind: 'older',
    status: 'unknown',
    actionClass: 'text-primary-600 hover:bg-state-accent-hover',
    showRelease: true,
    intent: 'drawer',
    releaseId: latestId,
  }
}

export function renderActionLabel(
  kind: TileKind,
  hasCurrentRelease: boolean,
  t: TFunction<'deployments'>,
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

export function renderStatus(
  kind: TileKind,
  drift: ReturnType<typeof computeDrift>,
  t: TFunction<'deployments'>,
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

export function renderDriftTitle(
  kind: TileKind,
  drift: ReturnType<typeof computeDrift>,
  t: TFunction<'deployments'>,
): string {
  switch (kind) {
    case 'latest':
      return t('overview.chip.latestTooltip')
    case 'behind':
      return t('overview.chip.behindTooltip', { count: drift.kind === 'behind' ? drift.steps : 0 })
    case 'older':
      return t('overview.chip.olderReleaseTooltip')
    case 'empty':
      return t('overview.chip.emptyTooltip')
    case 'deploying':
      return t('overview.chip.deployingTooltip')
    case 'failed':
      return t('overview.chip.failedTooltip')
  }
}
