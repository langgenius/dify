import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type CardProps = {
  name: string
  type: string
  required: boolean
  description?: string
  readOnly?: boolean
}

const Card: FC<CardProps> = ({ name, type, required, description, readOnly }) => {
  const { t } = useTranslation(['workflowModels'])

  return (
    <div className="flex flex-col py-0.5">
      <div className={cn('flex items-center gap-x-1 pr-0.5 pl-1', readOnly ? 'min-h-6' : 'h-6')}>
        <div
          className={cn(
            'border border-transparent px-1 py-px system-sm-semibold text-text-primary',
            readOnly ? 'wrap-anywhere whitespace-pre-wrap' : 'truncate',
          )}
        >
          {name}
        </div>
        <div className="px-1 py-0.5 system-xs-medium text-text-tertiary">{type}</div>
        {required && (
          <div className="px-1 py-0.5 system-2xs-medium-uppercase text-text-warning">
            {t(($) => $['nodes.llm.jsonSchema.required'], { ns: 'workflowModels' })}
          </div>
        )}
      </div>

      {description && (
        <div
          className={cn(
            'px-2 pb-1 system-xs-regular text-text-tertiary',
            readOnly ? 'wrap-anywhere whitespace-pre-wrap' : 'truncate',
          )}
        >
          {description}
        </div>
      )}
    </div>
  )
}

export default React.memo(Card)
