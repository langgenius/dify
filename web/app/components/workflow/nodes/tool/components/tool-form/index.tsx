'use client'
import type { FC } from 'react'
import type { Tool } from '@/app/components/tools/types'
import type { FormInputSchema } from '@/app/components/workflow/nodes/_base/components/form-input-item.helpers'
import type { ResourceVarInputs } from '@/app/components/workflow/nodes/_base/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { applyResetOnChange } from '@/app/components/tools/utils/reset-on-change'
import { resetToolSettingFieldValue } from '@/app/components/tools/utils/to-form-schema'
import ToolFormItem from './item'

type Props = Readonly<{
  staticSchema?: boolean
  readOnly: boolean
  nodeId: string
  schema: FormInputSchema[]
  value: ResourceVarInputs
  onChange: (value: ResourceVarInputs) => void
  onOpen?: (index: number) => void
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
  currentTool,
  currentProvider,
  showManageInputField,
  onManageInputField,
  extraParams,
}) => {
  const handleChange = useCallback(
    (nextValue: ResourceVarInputs) => {
      onChange(
        applyResetOnChange({
          schemas: schema,
          previousValue: value,
          nextValue,
          getResetValue: resetToolSettingFieldValue,
        }),
      )
    },
    [onChange, schema, value],
  )

  return (
    <div className="space-y-1">
      {schema.map((schema) => (
        <ToolFormItem
          key={schema.variable}
          readOnly={readOnly}
          staticSchema={staticSchema}
          nodeId={nodeId}
          schema={schema}
          value={value}
          onChange={handleChange}
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
