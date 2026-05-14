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

type EnvironmentChipProps = {
  appInstanceId: string
  row: EnvironmentDeployment
  releaseRows: ReleaseRow[]
}

type ChipKind = 'empty' | 'latest' | 'behind' | 'older' | 'deploying' | 'failed'

type ChipConfig = {
  kind: ChipKind
  dotClass: string
  suffixClass: string
  showRelease: boolean
  intent: 'drawer' | 'navigate' | 'disabled'
  releaseId?: string
}

export function EnvironmentChip({ appInstanceId, row, releaseRows }: EnvironmentChipProps) {
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

  const suffix = renderSuffix(config.kind, drift, t)
  const showRelease = config.showRelease && Boolean(row.currentRelease?.id)
  const isDisabled = config.intent === 'disabled'
  const tooltip = isDisabled ? t('overview.chip.needsReleaseFirst') : config.intent === 'navigate' ? t('overview.chip.openInDeployTab') : undefined

  function handleClick() {
    if (config.intent === 'disabled')
      return
    if (config.intent === 'navigate') {
      router.push(`/deployments/${appInstanceId}/deploy`)
      return
    }
    openDeployDrawer({ appInstanceId, environmentId: envId, releaseId: config.releaseId })
  }

  return (
    <button
      type="button"
      disabled={isDisabled}
      title={tooltip}
      onClick={handleClick}
      className={cn(
        'inline-flex max-w-[280px] items-center gap-2 rounded-full border px-3 py-1.5 system-xs-medium transition-colors',
        'border-divider-subtle bg-components-panel-bg text-text-secondary',
        'hover:bg-state-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-button-primary-bg',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-components-panel-bg',
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', config.dotClass)} />
      <span className="truncate text-text-primary">{environmentName(row.environment)}</span>
      {showRelease && (
        <span className="flex shrink-0 items-baseline gap-1 font-mono text-text-tertiary">
          <span>{releaseLabel(row.currentRelease)}</span>
          <span className="system-2xs-regular">{releaseCommit(row.currentRelease)}</span>
        </span>
      )}
      <span aria-hidden className="text-text-quaternary">·</span>
      <span className={cn('shrink-0', config.suffixClass)}>{suffix}</span>
    </button>
  )
}

function resolveConfig({ drift, status, hasAnyRelease, latestId, currentReleaseId }: {
  drift: ReturnType<typeof computeDrift>
  status: ReturnType<typeof deploymentStatus>
  hasAnyRelease: boolean
  latestId: string | undefined
  currentReleaseId: string | undefined
}): ChipConfig {
  if (status === 'deploying') {
    return {
      kind: 'deploying',
      dotClass: 'bg-util-colors-blue-blue-500 animate-pulse',
      suffixClass: 'text-util-colors-blue-blue-700',
      showRelease: false,
      intent: 'navigate',
    }
  }

  if (status === 'deploy_failed') {
    return {
      kind: 'failed',
      dotClass: 'bg-util-colors-red-red-500',
      suffixClass: 'text-util-colors-red-red-700',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId ?? latestId,
    }
  }

  if (drift.kind === 'undeployed') {
    return {
      kind: 'empty',
      dotClass: 'bg-text-quaternary',
      suffixClass: 'text-text-quaternary',
      showRelease: false,
      intent: hasAnyRelease ? 'drawer' : 'disabled',
      releaseId: latestId,
    }
  }

  if (drift.kind === 'up-to-date') {
    return {
      kind: 'latest',
      dotClass: 'bg-util-colors-green-green-500',
      suffixClass: 'text-util-colors-green-green-700',
      showRelease: true,
      intent: 'drawer',
      releaseId: currentReleaseId,
    }
  }

  if (drift.kind === 'behind') {
    return {
      kind: 'behind',
      dotClass: 'bg-util-colors-green-green-500',
      suffixClass: 'text-util-colors-warning-warning-700',
      showRelease: true,
      intent: 'drawer',
      releaseId: latestId,
    }
  }

  return {
    kind: 'older',
    dotClass: 'bg-util-colors-green-green-500',
    suffixClass: 'text-text-tertiary',
    showRelease: true,
    intent: 'drawer',
    releaseId: latestId,
  }
}

function renderSuffix(
  kind: ChipKind,
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
