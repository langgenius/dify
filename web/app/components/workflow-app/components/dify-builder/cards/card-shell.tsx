import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

export type DifyBuilderCardStatusState =
  | 'waiting'
  | 'working'
  | 'done'
  | 'skipped'
  | 'blocked'
  | 'failed'

export type DifyBuilderCardStatus = {
  label?: string
  state?: DifyBuilderCardStatusState
}

const statusClassNames: Record<DifyBuilderCardStatusState, { icon: string; color: string }> = {
  waiting: { icon: 'i-ri-time-line', color: 'text-text-accent' },
  working: {
    icon: 'i-ri-loader-4-line animate-spin motion-reduce:animate-none',
    color: 'text-text-accent',
  },
  done: { icon: 'i-ri-checkbox-circle-line', color: 'text-text-success' },
  skipped: { icon: 'i-ri-skip-forward-fill', color: 'text-text-tertiary' },
  blocked: { icon: 'i-ri-error-warning-line', color: 'text-text-warning' },
  failed: { icon: 'i-ri-close-circle-line', color: 'text-text-destructive' },
}

export const DifyBuilderCard = ({
  category,
  children,
  headline,
  invalidated = false,
  meta,
  status,
  subheadline,
}: {
  category: string
  children?: ReactNode
  headline?: string | null
  invalidated?: boolean
  meta?: string | null
  status?: DifyBuilderCardStatus
  subheadline?: string | null
}) => {
  const statusStyle = status?.state ? statusClassNames[status.state] : undefined
  const hasBody = children !== undefined && children !== null

  return (
    <article
      data-card-state={invalidated ? 'invalidated' : 'valid'}
      className={cn(
        'border-px w-full overflow-hidden rounded-xl border border-components-panel-border',
        invalidated && 'border-components-panel-border-subtle',
      )}
    >
      <header className="flex min-h-8 w-full items-center gap-1.5 bg-background-default-lighter px-4 py-2">
        <span
          title={category}
          className="min-w-24 flex-1 truncate system-xs-semibold-uppercase text-text-tertiary"
        >
          {category}
        </span>
        {(meta || status) && (
          <span className="flex min-w-0 shrink-0 items-center gap-2">
            {meta && (
              <span className="max-w-33 truncate system-xs-regular text-text-tertiary">{meta}</span>
            )}
            {status && (
              <span
                data-card-status={status.state}
                aria-hidden={status.label ? undefined : true}
                className={cn(
                  'flex min-w-0 items-center gap-1 system-xs-medium text-text-tertiary lowercase',
                  statusStyle?.color,
                )}
              >
                {statusStyle && (
                  <span aria-hidden className={cn('size-3.5 shrink-0', statusStyle.icon)} />
                )}
                {status.label && <span className="max-w-24 truncate">{status.label}</span>}
              </span>
            )}
          </span>
        )}
      </header>
      {headline && (
        <div className="flex min-w-0 flex-col gap-1 px-4 pt-3 pb-1">
          <h3 className="system-md-semibold wrap-break-word text-text-primary">{headline}</h3>
          {subheadline && (
            <p className="system-xs-regular wrap-break-word text-text-tertiary">{subheadline}</p>
          )}
        </div>
      )}
      {hasBody && <div className="min-w-0 px-4 py-3">{children}</div>}
    </article>
  )
}
