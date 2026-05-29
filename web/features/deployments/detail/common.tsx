'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type SectionProps = {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  layout?: 'block' | 'row'
  tone?: 'default' | 'destructive'
  showDivider?: boolean
}

type DetailEmptyStateProps = {
  icon: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  variant?: 'list' | 'section'
  className?: string
}

type DetailNoticeStateProps = {
  children: ReactNode
  icon?: string
  className?: string
}

export function SectionState({ children }: {
  children: ReactNode
}) {
  return (
    <div className="flex min-h-24 items-center justify-center border-y border-dashed border-divider-subtle px-4 py-6 text-center system-sm-regular text-text-tertiary">
      {children}
    </div>
  )
}

export function DetailListState({ children }: {
  children: ReactNode
}) {
  return (
    <div className="flex min-h-36 items-center justify-center border-y border-dashed border-divider-subtle px-4 py-12 text-center system-sm-regular text-text-tertiary">
      {children}
    </div>
  )
}

export function DetailEmptyState({
  icon,
  title,
  description,
  action,
  variant = 'list',
  className,
}: DetailEmptyStateProps) {
  const isList = variant === 'list'
  const hasDescription = Boolean(description)
  const hasAction = Boolean(action)

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center border-dashed text-center',
        isList
          ? 'min-h-60 border-y border-divider-subtle px-4 py-12'
          : 'min-h-36 rounded-lg border border-divider-subtle bg-background-default-subtle px-6 py-8',
        className,
      )}
    >
      <span
        className={cn(
          'mb-4 flex items-center justify-center border border-components-panel-border bg-background-default-subtle text-text-tertiary',
          isList ? 'size-11 rounded-xl' : 'size-10 rounded-lg bg-background-section-burn',
        )}
      >
        <span className={cn(icon, isList ? 'size-5' : 'size-4.5')} aria-hidden="true" />
      </span>
      <div className={cn(isList ? 'system-md-semibold text-text-primary' : 'system-sm-medium text-text-secondary')}>
        {title}
      </div>
      {hasDescription && (
        <p className={cn('mt-1 max-w-120 text-text-tertiary', isList ? 'system-sm-regular' : 'system-xs-regular')}>
          {description}
        </p>
      )}
      {hasAction && (
        <div className={isList ? 'mt-5' : 'mt-4'}>
          {action}
        </div>
      )}
    </div>
  )
}

export function DetailNoticeState({
  children,
  icon = 'i-ri-information-line',
  className,
}: DetailNoticeStateProps) {
  return (
    <div className={cn('flex min-h-9 items-start gap-1.5 rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary', className)}>
      <span className={cn(icon, 'mt-0.5 size-3.5 shrink-0 text-text-quaternary')} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export function Section({
  title,
  description,
  action,
  children,
  layout = 'block',
  tone = 'default',
  showDivider = true,
}: SectionProps) {
  const hasAction = Boolean(action)
  const titleClassName = cn(
    'system-sm-semibold',
    tone === 'destructive'
      ? 'text-util-colors-red-red-700'
      : layout === 'row'
        ? 'text-text-secondary'
        : 'text-text-primary',
  )
  const descriptionClassName = cn(
    'mt-1 body-xs-regular',
    tone === 'destructive' ? 'text-util-colors-red-red-600' : 'text-text-tertiary',
  )

  if (layout === 'row') {
    return (
      <section className={cn('py-4 first:pt-0 last:pb-0', showDivider && 'border-b border-divider-subtle last:border-b-0')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-x-6">
          <div className="flex min-w-0 shrink-0 flex-col sm:w-40 sm:pt-1">
            <div className={titleClassName}>
              {title}
            </div>
            {description && (
              <p className={descriptionClassName}>
                {description}
              </p>
            )}
          </div>
          <div className="min-w-0 grow">
            {hasAction
              ? (
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 grow">
                      {children}
                    </div>
                    <div className="shrink-0">
                      {action}
                    </div>
                  </div>
                )
              : children}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={cn('py-6 first:pt-0 last:pb-0', showDivider && 'border-b border-divider-subtle last:border-b-0')}>
      <div className="mb-3 flex min-w-0 flex-col">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className={titleClassName}>
            {title}
          </div>
          {hasAction && (
            <div className="shrink-0">
              {action}
            </div>
          )}
        </div>
        {description && (
          <p className={cn(descriptionClassName, 'max-w-150')}>
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">
        {children}
      </div>
    </section>
  )
}
