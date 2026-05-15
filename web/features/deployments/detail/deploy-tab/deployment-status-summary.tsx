'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { useTranslation } from 'react-i18next'
import { releaseLabel } from '../../release'
import {
  deploymentStatus,
  isUndeployedDeploymentRow,
} from '../../runtime-status'

export function DeploymentStatusSummary({ row }: {
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  if (isUndeployedDeploymentRow(row)) {
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-text-tertiary">
        <span className="size-1.5 rounded-full bg-text-quaternary" />
        {t('status.notDeployed')}
      </span>
    )
  }

  const status = deploymentStatus(row)

  if (status === 'deploying') {
    const hasTargetRelease = !!(row.currentRelease?.name || row.currentRelease?.id)
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-blue-blue-700">
        <span className="i-ri-loader-4-line size-3.5 animate-spin" />
        {hasTargetRelease
          ? t('deployTab.status.deployingRelease', { release: releaseLabel(row.currentRelease) })
          : t('status.deploying')}
      </span>
    )
  }

  if (status === 'deploy_failed') {
    const hasRunningRelease = !!row.currentRelease?.id
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-warning-warning-700">
        <span className="i-ri-alert-line size-3.5" />
        {t(hasRunningRelease ? 'deployTab.status.runningWithFailed' : 'deployTab.status.deployFailed')}
      </span>
    )
  }

  if (status === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-text-tertiary">
        <span className="i-ri-question-line size-3.5" />
        {t('status.unknown')}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-green-green-700">
      <span className="size-1.5 rounded-full bg-util-colors-green-green-500" />
      {t('status.ready')}
    </span>
  )
}
