'use client'

import type React from 'react'
import type { CSSProperties } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block animate-pulse rounded bg-util-colors-gray-gray-200 [animation-duration:1.2s] motion-reduce:animate-none',
        className,
      )}
      style={style}
    />
  )
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function EmptyInline({
  description,
  icon,
  positive = false,
  title,
}: {
  description: string
  icon: string
  positive?: boolean
  title: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
      <span
        aria-hidden
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          positive
            ? 'bg-state-success-hover text-text-success'
            : 'bg-background-section text-text-tertiary',
        )}
      >
        <span className={cn('size-5', icon)} />
      </span>
      <div className="flex flex-col items-center gap-1">
        <p className="system-md-medium text-text-primary">{title}</p>
        <p className="max-w-100 body-xs-regular text-text-tertiary">{description}</p>
      </div>
    </div>
  )
}

export function OverviewErrorInline() {
  const { t } = useTranslation('dataset')

  return (
    <EmptyInline
      icon="i-ri-error-warning-line"
      title={t(($) => $['newKnowledge.detailErrorTitle'])}
      description={t(($) => $['newKnowledge.detailErrorDescription'])}
    />
  )
}
