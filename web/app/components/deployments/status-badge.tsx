'use client'
import type { FC } from 'react'
import type { DeployStatus, EnvironmentHealth, EnvironmentMode } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type StatusBadgeProps = {
  status: DeployStatus
  className?: string
}

const statusStyles: Record<DeployStatus, string> = {
  ready: 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700',
  deploying: 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
  deploy_failed: 'border-util-colors-red-red-200 bg-util-colors-red-red-50 text-util-colors-red-red-700',
}

const statusKey = {
  ready: 'status.ready',
  deploying: 'status.deploying',
  deploy_failed: 'status.deployFailed',
} as const satisfies Record<DeployStatus, string>

const baseBadge = 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 system-xs-medium whitespace-nowrap'

export const StatusBadge: FC<StatusBadgeProps> = ({ status, className }) => {
  const { t } = useTranslation('deployments')
  return (
    <span className={cn(baseBadge, statusStyles[status], className)}>
      {status === 'deploying' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {t(statusKey[status])}
    </span>
  )
}

type ModeBadgeProps = {
  mode: EnvironmentMode
  className?: string
}

export const ModeBadge: FC<ModeBadgeProps> = ({ mode, className }) => {
  const { t } = useTranslation('deployments')
  const style = mode === 'shared'
    ? 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700'
    : 'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700'
  return (
    <span className={cn(baseBadge, style, className)}>
      {t(mode === 'shared' ? 'mode.shared' : 'mode.isolated')}
    </span>
  )
}

type HealthBadgeProps = {
  health: EnvironmentHealth
  className?: string
}

export const HealthBadge: FC<HealthBadgeProps> = ({ health, className }) => {
  const { t } = useTranslation('deployments')
  const style = health === 'ready'
    ? 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700'
    : 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700'
  return (
    <span className={cn(baseBadge, style, className)}>
      {t(health === 'ready' ? 'health.ready' : 'health.degraded')}
    </span>
  )
}
