'use client'
import type { FC } from 'react'
import type { ToolVarInputs } from '../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ToolFormItem from './item'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  onOpen?: (index: number) => void
  inPanel?: boolean
}

const ToolForm: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
}) => {
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
            inPanel={inPanel}
          />
        ))
      }
    </div>
  )
}
export default ToolForm
