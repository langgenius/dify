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

export function Section({
  title,
  description,
  action,
  children,
  layout = 'block',
  tone = 'default',
}: SectionProps) {
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
      <section className="border-b border-divider-subtle py-4 first:pt-0 last:border-b-0 last:pb-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-x-1">
          <div className="flex min-w-0 shrink-0 flex-col sm:w-[180px] sm:pt-1">
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
            {action
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
    <section className="border-b border-divider-subtle py-6 first:pt-0 last:border-b-0 last:pb-0">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={titleClassName}>
            {title}
          </div>
          {description && (
            <p className={cn(descriptionClassName, 'max-w-150')}>
              {description}
            </p>
          )}
        </div>
        {Boolean(action) && (
          <div className="shrink-0">
            {action}
          </div>
        )}
      </div>
      <div className="min-w-0">
        {children}
      </div>
    </section>
  )
}
