'use client'

import type { ReleaseDeployment } from './release-deployments'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'
import { isRuntimeDeploymentInProgress } from '../../../shared/domain/runtime-status'
import {
  deploymentStatusDotStatus,
  deploymentStatusDotTextClassName,
} from '../../../shared/ui/deployment-status-style'

export function DeployedToBadge({ item }: {
  item: ReleaseDeployment
}) {
  const { t } = useTranslation('deployments')
  const status = item.status
  const statusLabel = t($ => $[`versions.deployedStatus.${status}`])
  const dotStatus = deploymentStatusDotStatus(status)
  const isInProgress = isRuntimeDeploymentInProgress(status)
  const textClassName = deploymentStatusDotTextClassName(status)

  return (
    <span
      className={cn(
        'inline-flex max-w-full cursor-default items-center system-xs-medium',
        textClassName,
      )}
    >
      <StatusDot
        status={dotStatus}
        className={cn('mr-2 shrink-0', isInProgress && 'animate-pulse')}
      />
      <span className="truncate">
        {item.environmentName}
        {' · '}
        {statusLabel}
      </span>
    </span>
  )
}
