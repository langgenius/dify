'use client'

import type {
  EnvironmentDeployment,
  RuntimeInstanceStatus as RuntimeInstanceStatusValue,
} from '@dify/contracts/enterprise/types.gen'
import type { ComponentPropsWithRef } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'
import { isRuntimeDeploymentInProgress } from '../domain/runtime-status'
import {
  deploymentStatusDotStatus,
  deploymentStatusDotTextClassName,
  deploymentStatusLabelKey,
  deploymentStatusToneClassNames,
} from './deployment-status-style'

type DeploymentStatusBadgeProps = Omit<ComponentPropsWithRef<'span'>, 'children'> & {
  status: RuntimeInstanceStatusValue
  label: string
  variant?: 'badge' | 'status-dot'
}

export function DeploymentStatusBadge({
  status,
  label,
  className,
  variant = 'badge',
  ref,
  ...props
}: DeploymentStatusBadgeProps) {
  const isInProgress = isRuntimeDeploymentInProgress(status)

  if (variant === 'status-dot') {
    const dotStatus = deploymentStatusDotStatus(status)

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex max-w-full cursor-default items-center system-2xs-medium-uppercase',
          className,
        )}
        {...props}
      >
        <StatusDot
          status={dotStatus}
          className={cn('mr-2', isInProgress && 'animate-pulse')}
        />
        <span className={cn('truncate', deploymentStatusDotTextClassName(status))}>
          {label}
        </span>
      </span>
    )
  }

  const toneClassNames = deploymentStatusToneClassNames(status)
  const dotStatus = deploymentStatusDotStatus(status)

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex h-5 max-w-full cursor-default items-center gap-1 rounded-md border px-1.5 system-2xs-medium-uppercase',
        toneClassNames.badge,
        className,
      )}
      {...props}
    >
      <StatusDot
        status={dotStatus}
        className={cn('shrink-0', isInProgress && 'animate-pulse')}
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

type EnvironmentDeploymentBadgeProps = Omit<ComponentPropsWithRef<'span'>, 'children' | 'title'> & {
  row: EnvironmentDeployment
  showStatus?: boolean
  summaryLabel?: string
}

export function EnvironmentDeploymentBadge({
  row,
  className,
  showStatus = true,
  summaryLabel,
  'aria-label': ariaLabel,
  ref,
  ...props
}: EnvironmentDeploymentBadgeProps) {
  const { t } = useTranslation('deployments')
  const name = row.environment.displayName
  const status = row.status
  const toneClassNames = deploymentStatusToneClassNames(status)
  const dotStatus = deploymentStatusDotStatus(status)
  const isInProgress = isRuntimeDeploymentInProgress(status)
  const statusLabel = t(deploymentStatusLabelKey(status))
  const label = summaryLabel ?? `${name} · ${statusLabel}`
  const visibleLabel = showStatus ? `${name} · ${statusLabel}` : name

  return (
    <span
      ref={ref}
      aria-label={ariaLabel ?? label}
      className={cn(
        'inline-flex h-5 max-w-full cursor-default items-center gap-1 rounded-md border px-1.5 system-xs-medium',
        toneClassNames.badge,
        className,
      )}
      {...props}
    >
      <StatusDot
        status={dotStatus}
        className={cn('shrink-0', isInProgress && 'animate-pulse')}
      />
      <span className="truncate">{visibleLabel}</span>
    </span>
  )
}
