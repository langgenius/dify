import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

export type KnowledgeModelReadinessTone = 'destructive' | 'progress' | 'warning'

export const knowledgeModelReadinessActionClassName =
  'shrink-0 cursor-pointer rounded-sm system-sm-medium text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid'

export function KnowledgeModelReadinessNotice({
  action,
  className,
  description,
  title,
  tone,
}: {
  action?: ReactNode
  className?: string
  description?: ReactNode
  title: ReactNode
  tone: KnowledgeModelReadinessTone
}) {
  const isDestructive = tone === 'destructive'
  const isProgress = tone === 'progress'

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 overflow-hidden rounded-lg px-3.5 py-2.5',
        isDestructive
          ? 'bg-state-destructive-hover'
          : isProgress
            ? 'bg-state-accent-hover'
            : 'bg-state-warning-hover',
        className,
      )}
      role={isDestructive ? 'alert' : 'status'}
    >
      <span
        aria-hidden
        className={cn(
          'size-4 shrink-0',
          isProgress
            ? 'i-ri-loader-2-line animate-spin text-text-accent motion-reduce:animate-none'
            : isDestructive
              ? 'i-ri-error-warning-fill text-text-destructive'
              : 'i-ri-error-warning-fill text-text-warning',
        )}
      />
      <p className="min-w-0 flex-1 system-sm-regular text-text-secondary">
        {title}
        {description && (
          <>
            <span aria-hidden> — </span>
            {description}
          </>
        )}
      </p>
      {action}
    </div>
  )
}
