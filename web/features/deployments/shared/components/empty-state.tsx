'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type DeploymentEmptyStateVariant = 'page' | 'list' | 'section' | 'compact'
type DeploymentStateMessageVariant = 'page' | 'list' | 'section' | 'compact' | 'embedded'
type DeploymentEmptyStateAlign = 'center' | 'start'

type DeploymentEmptyStateProps = {
  icon?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  variant?: DeploymentEmptyStateVariant
  align?: DeploymentEmptyStateAlign
  className?: string
}

type DeploymentStateMessageProps = {
  children: ReactNode
  variant?: DeploymentStateMessageVariant
  className?: string
}

type DeploymentNoticeStateProps = {
  children: ReactNode
  icon?: string
  className?: string
}

const emptyStateContainerClassNames: Record<DeploymentEmptyStateVariant, string> = {
  page: 'col-span-full min-h-80 rounded-xl border border-divider-subtle bg-background-default-subtle px-6 py-12',
  list: 'min-h-60 rounded-lg border border-divider-subtle bg-background-default-subtle px-6 py-12',
  section:
    'min-h-36 rounded-lg border border-divider-subtle bg-background-default-subtle px-6 py-8',
  compact:
    'min-h-14 rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-3',
}

const stateMessageClassNames: Record<DeploymentStateMessageVariant, string> = {
  page: 'col-span-full flex min-h-80 items-center justify-center rounded-xl border border-dashed border-divider-subtle bg-background-default-subtle px-6 py-12 text-center system-sm-regular text-text-tertiary',
  list: 'flex min-h-36 items-center justify-center rounded-lg border border-dashed border-divider-subtle bg-background-default-subtle px-6 py-12 text-center system-sm-regular text-text-tertiary',
  section:
    'flex min-h-24 items-center justify-center rounded-lg border border-dashed border-divider-subtle bg-background-default-subtle px-4 py-6 text-center system-sm-regular text-text-tertiary',
  compact:
    'rounded-lg border border-dashed border-divider-subtle bg-background-default-subtle px-3 py-3 system-sm-regular text-text-tertiary',
  embedded: 'px-4 py-10 text-center system-sm-regular text-text-tertiary',
}

export function DeploymentEmptyState({
  icon,
  title,
  description,
  action,
  variant = 'list',
  align,
  className,
}: DeploymentEmptyStateProps) {
  const effectiveAlign = align ?? (variant === 'compact' ? 'start' : 'center')
  const isLarge = variant === 'page' || variant === 'list'
  const hasDescription = Boolean(description)
  const hasAction = Boolean(action)
  const hasIcon = Boolean(icon)

  return (
    <div
      data-slot="deployment-empty-state"
      className={cn(
        'flex flex-col justify-center border-dashed',
        effectiveAlign === 'center' ? 'items-center text-center' : 'items-start text-left',
        emptyStateContainerClassNames[variant],
        className,
      )}
    >
      {hasIcon && (
        <span
          className={cn(
            'flex items-center justify-center border border-components-panel-border bg-background-default-subtle text-text-tertiary',
            variant === 'compact' ? 'mb-2 size-8 rounded-lg' : 'mb-4',
            isLarge && 'size-11 rounded-xl',
            variant === 'section' && 'size-10 rounded-lg bg-background-section-burn',
          )}
        >
          <span
            className={cn(icon, isLarge ? 'size-5' : variant === 'section' ? 'size-4.5' : 'size-4')}
            aria-hidden="true"
          />
        </span>
      )}
      <div
        className={cn(
          isLarge
            ? 'system-md-semibold text-text-primary'
            : variant === 'compact' && !hasIcon && !hasDescription
              ? 'system-sm-regular text-text-tertiary'
              : 'system-sm-medium text-text-secondary',
        )}
      >
        {title}
      </div>
      {hasDescription && (
        <p
          className={cn(
            'mt-1 max-w-120 text-text-tertiary',
            isLarge ? 'system-sm-regular' : 'system-xs-regular',
          )}
        >
          {description}
        </p>
      )}
      {hasAction && (
        <div className={isLarge ? 'mt-5' : variant === 'compact' ? 'mt-3' : 'mt-4'}>{action}</div>
      )}
    </div>
  )
}

export function DeploymentStateMessage({
  children,
  variant = 'list',
  className,
}: DeploymentStateMessageProps) {
  return <div className={cn(stateMessageClassNames[variant], className)}>{children}</div>
}

export function DeploymentNoticeState({
  children,
  icon = 'i-ri-information-line',
  className,
}: DeploymentNoticeStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-9 items-start gap-1.5 rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary',
        className,
      )}
    >
      <span
        className={cn(icon, 'mt-0.5 size-3.5 shrink-0 text-text-quaternary')}
        aria-hidden="true"
      />
      <span className="min-w-0">{children}</span>
    </div>
  )
}
