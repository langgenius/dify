'use client'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Trigger } from '@/app/components/tools/types'
import type { FC } from 'react'
import type { PluginTriggerVarInputs } from '../../types'
import TriggerFormItem from './item'
import type { TriggerWithProvider } from '../../../../block-selector/types'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: PluginTriggerVarInputs
  onChange: (value: PluginTriggerVarInputs) => void
  onOpen?: (index: number) => void
  inPanel?: boolean
  currentTrigger?: Trigger
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
          />
        ))
      }
    </div>
  )
}
export default TriggerForm
