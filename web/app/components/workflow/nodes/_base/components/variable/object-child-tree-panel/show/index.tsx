'use client'
import type { FC } from 'react'
import React from 'react'
import type { StructuredOutput } from '../../../../../llm/types'
import Field from './field'

type Props = {
  payload: StructuredOutput
}

const ShowPanel: FC<Props> = ({
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
export default React.memo(ShowPanel)
