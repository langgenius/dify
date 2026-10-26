'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

// Shown before every action that starts model processing; the start button
// references `id` through aria-describedby so the cost context is announced with it.
export function ModelCostNotice({
  className,
  description,
  id,
  summary,
}: {
  className?: string
  description: ReactNode
  id: string
  summary?: ReactNode
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const titleId = useId()

  return (
    <div id={id} className={cn('flex flex-col gap-2', className)}>
      {summary != null && summary !== false && (
        <p className="system-sm-medium text-text-secondary">{summary}</p>
      )}
      <section
        aria-labelledby={titleId}
        className="flex gap-2.5 rounded-lg bg-state-warning-hover px-3.5 py-2.5"
      >
        <span
          aria-hidden
          className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0 text-text-warning"
        />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="system-sm-semibold text-text-primary">
            {t(($) => $['modelCost.title'], { ns: 'knowledgeSpace' })}
          </h3>
          <p className="mt-0.5 system-xs-regular text-text-secondary">{description}</p>
        </div>
      </section>
    </div>
  )
}
