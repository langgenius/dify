'use client'

import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
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
      <Alert type="warning" role="region" aria-labelledby={titleId}>
        <AlertTitle id={titleId}>
          {t(($) => $['modelCost.title'], { ns: 'knowledgeSpace' })}
        </AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    </div>
  )
}
