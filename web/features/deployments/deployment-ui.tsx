'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import type { DeploymentUiStatus } from './runtime-status'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import {
  deploymentStatusIconClassName,
  deploymentStatusLabelKey,
  deploymentStatusToneClassNames,
} from './deployment-ui-utils'
import { environmentName } from './environment'
import { deploymentStatus } from './runtime-status'

export function DeploymentStatusBadge({
  status,
  className,
  compact,
}: {
  status: DeploymentUiStatus
  className?: string
  compact?: boolean
}) {
  const { t } = useTranslation('deployments')
  const toneClassNames = deploymentStatusToneClassNames(status)

  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 system-xs-medium',
        toneClassNames.badge,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('size-3.5 shrink-0', deploymentStatusIconClassName(status), toneClassNames.icon)}
      />
      {!compact && <span className="truncate">{t(deploymentStatusLabelKey(status))}</span>}
    </span>
  )
}

export function EnvironmentDeploymentBadge({
  row,
  className,
  showStatus = true,
}: {
  row: EnvironmentDeployment
  className?: string
  showStatus?: boolean
}) {
  const { t } = useTranslation('deployments')
  const name = environmentName(row.environment)
  const status = deploymentStatus(row)
  const toneClassNames = deploymentStatusToneClassNames(status)
  const label = showStatus
    ? `${name} · ${t(deploymentStatusLabelKey(status))}`
    : name

  return (
    <span
      title={label}
      className={cn(
        'inline-flex h-6 max-w-full cursor-default items-center gap-1.5 rounded-md border px-2 system-xs-medium',
        toneClassNames.badge,
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', toneClassNames.dot, status === 'deploying' && 'animate-pulse')} />
      <span className="truncate">{label}</span>
    </span>
  )
}
