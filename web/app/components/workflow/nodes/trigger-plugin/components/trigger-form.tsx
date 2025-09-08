'use client'
import type { FC } from 'react'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import TriggerFormItem from './trigger-form-item'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { Tool } from '@/app/components/tools/types'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: Record<string, any>
  onChange: (value: Record<string, any>) => void
  inPanel?: boolean
  currentTrigger?: Tool
  currentProvider?: TriggerWithProvider
  extraParams?: Record<string, any>
}

const TriggerForm: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
  currentTrigger,
  currentProvider,
  extraParams,
}) => {
  return (
    <div className='space-y-1'>
      {
        schema.map((schemaItem, index) => (
          <TriggerFormItem
            key={index}
            readOnly={readOnly}
            nodeId={nodeId}
            schema={schemaItem}
            value={value}
            onChange={onChange}
            inPanel={inPanel}
            currentTrigger={currentTrigger}
            currentProvider={currentProvider}
            extraParams={extraParams}
          />
        ))
      }
    </div>
  )
}

export default TriggerForm
