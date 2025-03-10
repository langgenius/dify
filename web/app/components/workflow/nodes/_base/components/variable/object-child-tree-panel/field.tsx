'use client'
import type { FC } from 'react'
import React from 'react'
import { Type } from '../../../../llm/types'
import { getFieldType } from '../../../../llm/utils'
import type { Field as FieldType } from '../../../../llm/types'
import cn from '@/utils/classnames'
import TreeIndentLine from './tree-indent-line'

type Props = { name: string, payload: FieldType, depth?: number }

const Field: FC<Props> = ({
  name,
  payload,
  depth = 0,
}) => {
  return (
    <div>
      <div className={cn('flex pr-2 items-center justify-between rounded-md hover:bg-state-base-hover cursor-pointer')}>
        <div className='flex items-center h-6'>
          <TreeIndentLine depth={depth} />
          <div className='system-sm-medium text-text-secondary'>{name}</div>
        </div>
        <div className='system-xs-regular text-text-tertiary'>{getFieldType(payload)}</div>
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
