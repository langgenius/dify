'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { ToolVarInputs } from '../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { noop } from 'lodash-es'
import ToolFormItem from './item'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  onOpen?: (index: number) => void
}

const ToolForm: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  onOpen = noop,
}) => {
  const handleOpen = useCallback((index: number) => {
    return () => onOpen(index)
  }, [onOpen])
  return (
    <div className='space-y-1'>
      {
        schema.map((schema, index) => (
          <ToolFormItem
            key={index}
            readOnly={readOnly}
            nodeId={nodeId}
            schema={schema}
            value={value}
            onChange={onChange}
            onOpen={handleOpen(index)}
          />
        ))
      }
    </div>
  )
}
export default ToolForm
