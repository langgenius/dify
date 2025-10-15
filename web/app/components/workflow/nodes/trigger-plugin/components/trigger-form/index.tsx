'use client'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Event } from '@/app/components/tools/types'
import type { FC } from 'react'
import type { PluginTriggerVarInputs } from '@/app/components/workflow/nodes/trigger-plugin/types'
import TriggerFormItem from './item'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: PluginTriggerVarInputs
  onChange: (value: PluginTriggerVarInputs) => void
  onOpen?: (index: number) => void
  inPanel?: boolean
  currentTrigger?: Event
  currentProvider?: TriggerWithProvider
  extraParams?: Record<string, any>
  disableVariableInsertion?: boolean
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
  disableVariableInsertion = false,
}) => {
  return (
    <div className='space-y-1'>
      {
        schema.map((schema, index) => (
          <TriggerFormItem
            key={index}
            readOnly={readOnly}
            nodeId={nodeId}
            schema={schema}
            value={value}
            onChange={onChange}
            inPanel={inPanel}
            currentTrigger={currentTrigger}
            currentProvider={currentProvider}
            extraParams={extraParams}
            disableVariableInsertion={disableVariableInsertion}
          />
        ))
      }
    </div>
  )
}
export default TriggerForm
