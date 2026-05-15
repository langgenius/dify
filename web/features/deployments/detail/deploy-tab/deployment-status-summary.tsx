'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { releaseLabel } from '../../release'
import {
  deploymentStatus,
  isUndeployedDeploymentRow,
} from '../../runtime-status'

const StatusIconSlot = ({ children }: { children: ReactNode }) => {
  return (
    <span className="flex size-3 shrink-0 items-center justify-center">
      {children}
    </span>
  )
}

export function DeploymentStatusSummary({ row }: {
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  if (isUndeployedDeploymentRow(row)) {
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-text-tertiary">
        <StatusIconSlot>
          <span className="size-1.5 rounded-full bg-text-quaternary" />
        </StatusIconSlot>
        {t('status.notDeployed')}
      </span>
    )
  }

  const status = deploymentStatus(row)

  if (status === 'deploying') {
    const hasTargetRelease = !!(row.currentRelease?.name || row.currentRelease?.id)
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-blue-blue-700">
        <StatusIconSlot>
          <span className="i-ri-loader-4-line size-2 animate-spin" />
        </StatusIconSlot>
        {hasTargetRelease
          ? t('deployTab.status.deployingRelease', { release: releaseLabel(row.currentRelease) })
          : t('status.deploying')}
      </span>
    )
  }

  if (status === 'deploy_failed') {
    const hasRunningRelease = !!row.currentRelease?.id
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-red-red-700">
        <StatusIconSlot>
          <span className="i-ri-alert-line size-3" />
        </StatusIconSlot>
        {t(hasRunningRelease ? 'deployTab.status.runningWithFailed' : 'deployTab.status.deployFailed')}
      </span>
    )
  }

  if (status === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-text-tertiary">
        <StatusIconSlot>
          <span className="i-ri-question-line size-3" />
        </StatusIconSlot>
        {t('status.unknown')}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-green-green-700">
      <StatusIconSlot>
        <span className="size-1.5 rounded-full bg-util-colors-green-green-500" />
      </StatusIconSlot>
      {t('status.ready')}
    </span>
  )
}
