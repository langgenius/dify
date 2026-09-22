'use client'
import type { FC } from 'react'
import type { Tool } from '@/app/components/tools/types'
import type { FormInputSchema } from '@/app/components/workflow/nodes/_base/components/form-input-item.helpers'
import type { ResourceVarInputs } from '@/app/components/workflow/nodes/_base/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import ToolFormItem from './item'

type Props = Readonly<{
  staticSchema?: boolean
  readOnly: boolean
  nodeId: string
  schema: FormInputSchema[]
  value: ResourceVarInputs
  onChange: (value: ResourceVarInputs) => void
  onOpen?: (index: number) => void
  inPanel?: boolean
  currentTool?: Tool
  currentProvider?: ToolWithProvider
  showManageInputField?: boolean
  onManageInputField?: () => void
  extraParams?: Record<string, any>
}>

const ToolForm: FC<Props> = ({
  readOnly,
  staticSchema = false,
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
      {schema.map((schema, index) => (
        <ToolFormItem
          key={index}
          readOnly={readOnly}
          staticSchema={staticSchema}
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
          providerType={staticSchema ? undefined : 'tool'}
        />
      ))}
    </div>
  )
}
export default ToolForm
