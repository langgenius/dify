'use client'
import type { FC } from 'react'
import React from 'react'
import type { Field as FieldType, StructuredOutput } from '../../../../../llm/types'
import Field from './field'

type Props = {
  root: { nodeName: string, attrName: string }
  payload: StructuredOutput
  onSelect: (field: FieldType) => void
}

const PickerPanel: FC<Props> = ({
  root,
  payload,
}) => {
  const schema = payload.schema
  const fieldNames = Object.keys(schema.properties)
  return (
    <div className='w-[296px] p-1 pb-0 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]'>
      {/* Root info */}
      <div className='px-2 py-1 flex justify-between items-center'>
        <div className='flex'>
          <div className='max-w-[100px] truncate system-sm-medium text-text-tertiary'>{root.nodeName}</div>
          <div className='system-sm-medium text-text-tertiary'>.</div>
          <div className='system-sm-medium text-text-secondary'>{root.attrName}</div>
        </div>
        {/* It must be object */}
        <div className='shrink-0 ml-2 system-xs-regular text-text-tertiary'>object</div>
      </div>
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
export default React.memo(PickerPanel)
