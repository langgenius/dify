'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { useTranslation } from 'react-i18next'
import {
  isUndeployedDeploymentRow,
} from '../../../shared/domain/runtime-status'
import { DeploymentStatusBadge } from '../../../shared/ui/deployment-status-badge'

export function DeploymentStatusSummary({ row }: {
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  const status = row.status

  if (status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING) {
    return (
      <DeploymentStatusBadge
        status={status}
        label={t(`status.${status}`)}
        variant="status-dot"
      />
    )
  }

  if (isUndeployedDeploymentRow(row)) {
    return (
      <DeploymentStatusBadge
        status={RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED}
        label={t(`status.${RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED}`)}
        variant="status-dot"
      />
    )
  }

  if (status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING) {
    const targetRelease = row.desiredRelease ?? row.currentRelease
    if (!targetRelease) {
      return (
        <DeploymentStatusBadge
          status={RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING}
          label={t(`status.${RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING}`)}
          variant="status-dot"
        />
      )
    }

    return (
      <DeploymentStatusBadge
        status={status}
        label={t('deployTab.status.deployingRelease', { release: targetRelease.displayName })}
        variant="status-dot"
      />
    )
  }

  if (status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED) {
    const hasRunningRelease = Boolean(row.currentRelease)
    return (
      <DeploymentStatusBadge
        status={status}
        label={t(hasRunningRelease ? 'deployTab.status.runningWithFailed' : 'deployTab.status.deployFailed')}
        variant="status-dot"
      />
    )
  }

  if (status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DRIFTED) {
    const hasRunningRelease = Boolean(row.currentRelease)
    return (
      <DeploymentStatusBadge
        status={status}
        label={t(hasRunningRelease ? 'deployTab.status.runningOutOfSync' : `status.${status}`)}
        variant="status-dot"
      />
    )
  }

  if (status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_INVALID) {
    return (
      <DeploymentStatusBadge
        status={status}
        label={t(`status.${status}`)}
        variant="status-dot"
      />
    )
  }

  if (status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED) {
    return (
      <DeploymentStatusBadge
        status={status}
        label={t(`status.${status}`)}
        variant="status-dot"
      />
    )
  }

  return (
    <DeploymentStatusBadge
      status={RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY}
      label={t(`status.${RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY}`)}
      variant="status-dot"
    />
  )
}
