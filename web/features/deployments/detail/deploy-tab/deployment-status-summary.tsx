'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { useTranslation } from 'react-i18next'
import { DeploymentStatusBadge } from '../../deployment-ui'
import { releaseLabel } from '../../release'
import {
  deploymentStatus,
  isUndeployedDeploymentRow,
} from '../../runtime-status'

export function DeploymentStatusSummary({ row }: {
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  const status = deploymentStatus(row)

  if (status === 'undeploying') {
    return (
      <DeploymentStatusBadge
        status="undeploying"
        label={t('status.undeploying')}
      />
    )
  }

  if (isUndeployedDeploymentRow(row)) {
    return (
      <DeploymentStatusBadge
        status="not_deployed"
        label={t('status.notDeployed')}
      />
    )
  }

  if (status === 'deploying') {
    const targetRelease = row.desiredRelease ?? row.currentRelease
    const hasTargetRelease = !!(targetRelease?.name || targetRelease?.id)
    if (!hasTargetRelease) {
      return (
        <DeploymentStatusBadge
          status="undeploying"
          label={t('status.undeploying')}
        />
      )
    }

    return (
      <DeploymentStatusBadge
        status="deploying"
        label={t('deployTab.status.deployingRelease', { release: releaseLabel(targetRelease) })}
      />
    )
  }

  if (status === 'deploy_failed') {
    const hasRunningRelease = !!row.currentRelease?.id
    return (
      <DeploymentStatusBadge
        status="deploy_failed"
        label={t(hasRunningRelease ? 'deployTab.status.runningWithFailed' : 'deployTab.status.deployFailed')}
      />
    )
  }

  if (status === 'drifted') {
    const hasRunningRelease = !!row.currentRelease?.id
    return (
      <DeploymentStatusBadge
        status="drifted"
        label={t(hasRunningRelease ? 'deployTab.status.runningOutOfSync' : 'status.drifted')}
      />
    )
  }

  if (status === 'invalid') {
    return (
      <DeploymentStatusBadge
        status="invalid"
        label={t('status.invalid')}
      />
    )
  }

  if (status === 'unknown') {
    return (
      <DeploymentStatusBadge
        status="unknown"
        label={t('status.unknown')}
      />
    )
  }

  return (
    <DeploymentStatusBadge
      status="ready"
      label={t('status.ready')}
    />
  )
}
