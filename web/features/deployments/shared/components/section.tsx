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
