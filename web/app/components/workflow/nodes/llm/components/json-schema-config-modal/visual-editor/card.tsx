import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type CardProps = {
  name: string
  type: string
  required: boolean
  description?: string
}

const Card: FC<CardProps> = ({
  name,
  type,
  required,
  description,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col py-0.5">
      <div className="flex h-6 items-center gap-x-1 pr-0.5 pl-1">
        <div className="truncate border border-transparent px-1 py-px system-sm-semibold text-text-primary">
          {name}
        </div>
        <div className="px-1 py-0.5 system-xs-medium text-text-tertiary">
          {type}
        </div>
        {
          required && (
            <div className="px-1 py-0.5 system-2xs-medium-uppercase text-text-warning">
              {t('nodes.llm.jsonSchema.required', { ns: 'workflow' })}
            </div>
          )
        }
      </div>

      {description && (
        <div className="truncate px-2 pb-1 system-xs-regular text-text-tertiary">
          {description}
        </div>
      )}
    </div>
  )
}

export default React.memo(Card)
