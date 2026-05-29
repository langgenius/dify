'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import type { DeploymentUiStatus } from '../../runtime-status'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import {
  deploymentStatusIconClassName,
  deploymentStatusToneClassNames,
} from '../../deployment-ui-utils'
import { releaseLabel } from '../../release'
import {
  deploymentStatus,
  isUndeployedDeploymentRow,
} from '../../runtime-status'

function DeploymentStatusPill({ status, label }: {
  status: DeploymentUiStatus
  label: string
}) {
  const toneClassNames = deploymentStatusToneClassNames(status)

  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 system-xs-medium',
        toneClassNames.badge,
      )}
    >
      <span
        aria-hidden
        className={cn('size-3.5 shrink-0', deploymentStatusIconClassName(status), toneClassNames.icon)}
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

export function DeploymentStatusSummary({ row }: {
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  if (isUndeployedDeploymentRow(row)) {
    return (
      <DeploymentStatusPill
        status="not_deployed"
        label={t('status.notDeployed')}
      />
    )
  }

  const status = deploymentStatus(row)

  if (status === 'deploying') {
    const targetRelease = row.desiredRelease ?? row.currentRelease
    const hasTargetRelease = !!(targetRelease?.name || targetRelease?.id)
    const statusLabel = hasTargetRelease
      ? t('deployTab.status.deployingRelease', { release: releaseLabel(targetRelease) })
      : t('status.undeploying')

    return <DeploymentStatusPill status="deploying" label={statusLabel} />
  }

  if (status === 'deploy_failed') {
    const hasRunningRelease = !!row.currentRelease?.id
    return (
      <DeploymentStatusPill
        status="deploy_failed"
        label={t(hasRunningRelease ? 'deployTab.status.runningWithFailed' : 'deployTab.status.deployFailed')}
      />
    )
  }

  if (status === 'drifted') {
    const hasRunningRelease = !!row.currentRelease?.id
    return (
      <DeploymentStatusPill
        status="drifted"
        label={t(hasRunningRelease ? 'deployTab.status.runningOutOfSync' : 'status.drifted')}
      />
    )
  }

  if (status === 'invalid') {
    return (
      <DeploymentStatusPill
        status="invalid"
        label={t('status.invalid')}
      />
    )
  }

  if (status === 'unknown') {
    return (
      <DeploymentStatusPill
        status="unknown"
        label={t('status.unknown')}
      />
    )
  }

  return (
    <DeploymentStatusPill
      status="ready"
      label={t('status.ready')}
    />
  )
}
