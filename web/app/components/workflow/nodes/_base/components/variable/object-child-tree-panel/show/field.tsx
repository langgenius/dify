'use client'
import type { FC } from 'react'
import React from 'react'
import { Type } from '../../../../../llm/types'
import { getFieldType } from '../../../../../llm/utils'
import type { Field as FieldType } from '../../../../../llm/types'
import cn from '@/utils/classnames'
import TreeIndentLine from '../tree-indent-line'
import { useTranslation } from 'react-i18next'

const MAX_DEPTH = 10

type Props = { name: string, payload: FieldType, depth?: number }

const Field: FC<Props> = ({
  name,
  payload,
  depth = 1,
}) => {
  const { t } = useTranslation()
  if (depth > MAX_DEPTH + 1)
    return null
  return (
    <div>
      <div>
        <div className={cn('flex pr-2')}>
          <TreeIndentLine depth={depth} />
          <div>
            <div className='flex'>
              <div className='h-6 truncate system-sm-medium text-text-secondary leading-6'>{name}</div>
              <div className='ml-3 shrink-0 system-xs-regular text-text-tertiary leading-6'>{getFieldType(payload)}</div>
              <div className='ml-3 text-text-warning system-2xs-medium-uppercase leading-6'>Required</div>
            </div>
            {payload.description && (
              <div className='system-xs-regular text-text-tertiary truncate'>{payload.description}</div>
            )}
          </div>

        </div>

      </div>

      {payload.type === Type.object && payload.properties && (
        <div>
          {Object.keys(payload.properties).map(name => (
            <Field
              key={name}
              name={name}
              payload={payload.properties?.[name] as FieldType}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
export default React.memo(Field)
