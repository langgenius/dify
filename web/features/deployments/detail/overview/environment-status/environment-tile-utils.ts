import type { RuntimeInstanceStatus as RuntimeInstanceStatusValue } from '@dify/contracts/enterprise/types.gen'
import type { TFunction } from 'i18next'
import type { computeDrift } from './overview-drift'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { isRuntimeDeploymentInProgress } from '../../../shared/domain/runtime-status'

export type TileKind = 'empty' | 'latest' | 'behind' | 'older' | 'deploying' | 'failed'

export type TileConfig = {
  kind: TileKind
  status: RuntimeInstanceStatusValue
  actionClass: string
  showRelease: boolean
  intent: 'drawer' | 'navigate' | 'disabled'
  releaseId?: string
}

export function resolveConfig({
  drift,
  status,
  hasAnyRelease,
  latestId,
  currentReleaseId,
}: {
  drift: ReturnType<typeof computeDrift>
  status: RuntimeInstanceStatusValue
  hasAnyRelease: boolean
  latestId: string | undefined
  currentReleaseId: string | undefined
}): TileConfig {
  if (isRuntimeDeploymentInProgress(status)) {
    return {
      kind: 'deploying',
      status,
      actionClass: 'text-text-secondary hover:bg-state-base-hover hover:text-text-primary',
      showRelease: true,
      intent: 'navigate',
    }
  }

  if (status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED) {
    return {
      kind: 'failed',
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED,
      actionClass: 'text-primary-600 hover:bg-state-accent-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId ?? latestId,
    }
  }

  if (drift.kind === 'undeployed') {
    return {
      kind: 'empty',
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
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
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
      actionClass: 'text-text-secondary hover:bg-state-base-hover hover:text-text-primary',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId,
    }
  }

  if (drift.kind === 'behind') {
    return {
      kind: 'behind',
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DRIFTED,
      actionClass: 'text-primary-600 hover:bg-state-accent-hover',
      showRelease: true,
      intent: 'drawer',
      releaseId: latestId,
    }
  }

  return {
    kind: 'older',
    status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED,
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
      return t(($) => $['overview.cardAction.deployLatest'])
    case 'latest':
      return t(($) => $['overview.cardAction.redeploy'])
    case 'deploying':
      return t(($) => $['overview.cardAction.viewProgress'])
    case 'failed':
      return hasCurrentRelease
        ? t(($) => $['overview.cardAction.redeploy'])
        : t(($) => $['overview.cardAction.deployLatest'])
  }
}

export function renderStatus(
  kind: TileKind,
  drift: ReturnType<typeof computeDrift>,
  t: TFunction<'deployments'>,
): string {
  switch (kind) {
    case 'empty':
      return t(($) => $['overview.chip.empty'])
    case 'latest':
      return t(($) => $['overview.chip.latest'])
    case 'behind':
      return t(($) => $['overview.chip.behind'], {
        count: drift.kind === 'behind' ? drift.steps : 0,
      })
    case 'older':
      return t(($) => $['overview.chip.olderRelease'])
    case 'deploying':
      return t(($) => $['overview.chip.deploying'])
    case 'failed':
      return t(($) => $['overview.chip.failed'])
  }
}

export function renderDriftTitle(
  kind: TileKind,
  drift: ReturnType<typeof computeDrift>,
  t: TFunction<'deployments'>,
): string {
  switch (kind) {
    case 'latest':
      return t(($) => $['overview.chip.latestTooltip'])
    case 'behind':
      return t(($) => $['overview.chip.behindTooltip'], {
        count: drift.kind === 'behind' ? drift.steps : 0,
      })
    case 'older':
      return t(($) => $['overview.chip.olderReleaseTooltip'])
    case 'empty':
      return t(($) => $['overview.chip.emptyTooltip'])
    case 'deploying':
      return t(($) => $['overview.chip.deployingTooltip'])
    case 'failed':
      return t(($) => $['overview.chip.failedTooltip'])
  }
}
