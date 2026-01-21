'use client'
import type { FC } from 'react'
import type { ToolVarInputs } from '../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import ToolFormItem from './item'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  onOpen?: (index: number) => void
  inPanel?: boolean
  currentTool?: Tool
  currentProvider?: ToolWithProvider
  showManageInputField?: boolean
  onManageInputField?: () => void
  extraParams?: Record<string, any>
}

const ToolForm: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
  currentTool,
  currentProvider,
  showManageInputField,
  onManageInputField,
  extraParams,
}) => {
  return (
    <div className="space-y-1">
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
            currentTool={currentTool}
            currentProvider={currentProvider}
            showManageInputField={showManageInputField}
            onManageInputField={onManageInputField}
            extraParams={extraParams}
            providerType="tool"
          />
        ))
      }
    </div>
  )
}
export default ToolForm
