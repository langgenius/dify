import React, { type FC } from 'react'
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
    <div className='flex flex-col py-0.5'>
      <div className='flex items-center gap-x-1 p-0.5 pl-1'>
        <div className='px-1 py-0.5 text-text-primary system-sm-semibold truncate'>
          {name}
        </div>
        <div className='px-1 py-0.5 text-text-tertiary system-xs-medium'>
          {type}
        </div>
        {
          required && (
            <div className='px-1 py-0.5 text-text-warning system-2xs-medium-uppercase'>
              {t('workflow.nodes.llm.jsonSchema.required')}
            </div>
          )
        }
      </div>

      {description && (
        <div className='px-2 pb-1 text-text-tertiary system-xs-regular truncate'>
          {description}
        </div>
      )}
    </div>
  )
}

export default React.memo(Card)
