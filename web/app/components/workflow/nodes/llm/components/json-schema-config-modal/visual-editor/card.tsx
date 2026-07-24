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
      <div className="flex h-6 items-center gap-x-1 pl-1 pr-0.5">
        <div className="system-sm-semibold truncate border border-transparent px-1 py-px text-text-primary">
          {name}
        </div>
        <div className="system-xs-medium px-1 py-0.5 text-text-tertiary">
          {type}
        </div>
        {
          required && (
            <div className="system-2xs-medium-uppercase px-1 py-0.5 text-text-warning">
              {t('nodes.llm.jsonSchema.required', { ns: 'workflow' })}
            </div>
          )
        }
      </div>

      {description && (
        <div className="system-xs-regular truncate px-2 pb-1 text-text-tertiary">
          {description}
        </div>
      )}
    </div>
  )
}

export default React.memo(Card)
