'use client'
import type { FC } from 'react'
import React from 'react'
import type { Field as FieldType, StructuredOutput } from '../../../../../llm/types'
import Field from './field'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  root: { nodeName?: string, attrName: string }
  payload: StructuredOutput
  readonly?: boolean
  onSelect?: (field: FieldType) => void
}

export const PickerPanelMain: FC<Props> = ({
  className,
  root,
  payload,
  readonly,
}) => {
  const schema = payload.schema
  const fieldNames = Object.keys(schema.properties)
  return (
    <div className={cn(className)}>
      {/* Root info */}
      <div className='px-2 py-1 flex justify-between items-center'>
        <div className='flex'>
          {root.nodeName && (
            <>
              <div className='max-w-[100px] truncate system-sm-medium text-text-tertiary'>{root.nodeName}</div>
              <div className='system-sm-medium text-text-tertiary'>.</div>
            </>
          )}
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
          readonly={readonly}
        />
      ))}
    </div>
  )
}

const PickerPanel: FC<Props> = ({
  className,
  ...props
}) => {
  return (
    <div className={cn('w-[296px] p-1 pb-0 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]', className)}>
      <PickerPanelMain {...props} />
    </div>
  )
}
export default React.memo(PickerPanel)
