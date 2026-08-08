'use client'
import type { FC } from 'react'
import type { ToolVarInputs } from '../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useResetOnChange } from '@/app/components/tools/hooks/use-reset-on-change'
import { resetToolSettingFieldValue } from '@/app/components/tools/utils/to-form-schema'
import ToolFormItem from './item'

type Props = Readonly<{
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
}>

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
  const handleReset = useCallback(
    (schemasToReset: CredentialFormSchema[]) => {
      const nextValue = { ...value }
      schemasToReset.forEach((schema) => {
        nextValue[schema.variable] = resetToolSettingFieldValue(schema)
      })
      onChange(nextValue)
    },
    [onChange, value],
  )

  useResetOnChange({ schemas: schema, value, onReset: handleReset })

  return (
    <div className="space-y-1">
      {schema.map((schema) => (
        <ToolFormItem
          key={schema.variable}
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
      ))}
    </div>
  )
}
export default ToolForm
