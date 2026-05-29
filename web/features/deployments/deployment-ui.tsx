'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import type { ComponentPropsWithoutRef } from 'react'
import type { DeploymentUiStatus } from './runtime-status'
import { cn } from '@langgenius/dify-ui/cn'
import { forwardRef } from 'react'
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

type EnvironmentDeploymentBadgeProps = Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'title'> & {
  row: EnvironmentDeployment
  showStatus?: boolean
  summaryLabel?: string
}

export const EnvironmentDeploymentBadge = forwardRef<HTMLSpanElement, EnvironmentDeploymentBadgeProps>(function EnvironmentDeploymentBadge({
  row,
  className,
  showStatus = true,
  summaryLabel,
  'aria-label': ariaLabel,
  ...props
}, ref) {
  const { t } = useTranslation('deployments')
  const name = environmentName(row.environment)
  const status = deploymentStatus(row)
  const toneClassNames = deploymentStatusToneClassNames(status)
  const statusLabel = t(deploymentStatusLabelKey(status))
  const label = summaryLabel ?? `${name} · ${statusLabel}`
  const visibleLabel = showStatus ? `${name} · ${statusLabel}` : name

  return (
    <span
      ref={ref}
      aria-label={ariaLabel ?? label}
      className={cn(
        'inline-flex h-6 max-w-full cursor-default items-center gap-1.5 rounded-md border px-2 system-xs-medium',
        toneClassNames.badge,
        className,
      )}
      {...props}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', toneClassNames.dot, status === 'deploying' && 'animate-pulse')} />
      <span className="truncate">{visibleLabel}</span>
    </span>
  )
})
