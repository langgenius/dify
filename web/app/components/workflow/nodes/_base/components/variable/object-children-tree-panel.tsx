'use client'
import type { FC } from 'react'
import React from 'react'
import type { Field as FieldType, StructuredOutput } from '../../../llm/types'
import { Type } from '../../../llm/types'
import { getFieldType } from '../../../llm/utils'
import cn from '@/utils/classnames'

type Props = {
  payload: StructuredOutput
  onSelect: (field: FieldType) => void
}

// TODO: depth can be depth 10. item 12
const indentClassName: Record<number, string> = {
  0: 'pl-[10px]',
  1: 'pl-[22px]',
  2: 'pl-[30px]',
  3: 'pl-[40px]',
  4: 'pl-[50px]',
}

const Field: FC<{ name: string, payload: FieldType, depth?: number }> = ({
  name,
  payload,
  depth = 0,
}) => {
  return (
    <div>
      <div className={cn('flex items-center h-6 justify-between', indentClassName[depth])}>
        {/* indent line */}
        <div className={cn('mr-3 h-6 w-px bg-divider-regular')}></div>
        <div>{name}</div>
        <div>{getFieldType(payload)}</div>
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

const ObjectChildrenTreePanel: FC<Props> = ({
  payload,
}) => {
  const schema = payload.schema
  const fieldNames = Object.keys(schema.properties)
  return (
    <div>
      {fieldNames.map(name => (
        <Field
          key={name}
          name={name}
          payload={schema.properties[name]}
        />
      ))}
    </div>
  )
}
export default React.memo(ObjectChildrenTreePanel)
