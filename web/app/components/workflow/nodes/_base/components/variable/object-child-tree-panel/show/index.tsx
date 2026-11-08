'use client'
import type { FC } from 'react'
import * as React from 'react'
import Field from './field'

type Props = Readonly<{
  payload: { schema: unknown }
  rootClassName?: string
}>

const ShowPanel: FC<Props> = ({ payload, rootClassName }) => {
  const schema = payload.schema
  if (!schema || typeof schema !== 'object' || !('properties' in schema)) return null
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null
  const required = 'required' in schema && Array.isArray(schema.required) ? schema.required : []

  return (
    <div className="relative -left-1.75">
      {Object.entries(properties).map(([name, field]: [string, unknown]) => (
        <Field
          key={name}
          name={name}
          payload={field}
          required={required.includes(name)}
          rootClassName={rootClassName}
        />
      ))}
    </div>
  )
}
export default React.memo(ShowPanel)
